import { LogPayload, SessionMetadata } from '../core/LogPayload.js';
import { openDB, wrapRequest, runTransaction } from '../utils/idb.js';

export interface IndexedDBManagerConfig {
  dbPrefix: string;
  scriptVersion: string;
  sessionId: string;
  wmeVersion: string | null;
  maxArchivedSessions?: number;
  flushIntervalMs?: number;
}

const DEFAULT_CONFIG = {
  maxArchivedSessions: 15,
  flushIntervalMs: 2000,
};

export class IndexedDBManager {
  private dbPrefix: string;
  private maxArchivedSessions: number;
  private scriptVersion: string;
  private sessionId: string;
  private wmeVersion: string | null;
  private flushIntervalMs: number;
  private db: IDBDatabase | null = null;
  private queue: LogPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private loggerVersion = '1.0.0';
  private schemaVersion = '1.0.0';

  constructor(config: IndexedDBManagerConfig) {
    const merged = Object.assign({}, DEFAULT_CONFIG, config);
    this.dbPrefix = merged.dbPrefix;
    this.maxArchivedSessions = merged.maxArchivedSessions;
    this.scriptVersion = merged.scriptVersion;
    this.sessionId = merged.sessionId;
    this.wmeVersion = merged.wmeVersion;
    this.flushIntervalMs = merged.flushIntervalMs;
  }

  /**
   * Returns the database name with prefix.
   */
  getDatabaseName(): string {
    return `LogStreamDB_${this.dbPrefix}`;
  }

  /**
   * Initializes the database connection and saves session metadata.
   */
  async init(): Promise<void> {
    const dbName = this.getDatabaseName();

    this.db = await openDB(dbName, 1, {
      onUpgradeNeeded: (db) => {
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
      },
    });

    const now = Date.now();
    const metadata: SessionMetadata = {
      id: this.sessionId,
      createdAt: now,
      lastUpdated: now,
      scriptVersion: this.scriptVersion,
      wmeVersion: this.wmeVersion ?? 'unknown',
      loggerVersion: this.loggerVersion,
      schemaVersion: this.schemaVersion,
    };

    try {
      await this.saveSessionMetadata(metadata);
      this.startHeartbeat();
    } catch (err) {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      throw err;
    }
  }

  /**
   * Saves a session metadata record.
   */
  async saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction('sessions', 'readwrite');
    const store = transaction.objectStore('sessions');
    await wrapRequest(store.put(metadata));
  }

  /**
   * Periodically updates the current session's lastUpdated timestamp.
   */
  async touchSession(): Promise<void> {
    if (!this.db) return;
    const transaction = this.db.transaction('sessions', 'readwrite');
    const store = transaction.objectStore('sessions');
    const metadata = (await wrapRequest(store.get(this.sessionId))) as SessionMetadata;
    if (metadata) {
      metadata.lastUpdated = Date.now();
      await wrapRequest(store.put(metadata));
    }
  }

  /**
   * Starts the session heartbeat interval.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.touchSession().catch(() => {});
    }, 10000); // 10-second heartbeat
  }

  /**
   * Stops the session heartbeat interval.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Writes a log entry, scheduling a flush or flushing immediately for high priority.
   */
  async writeLog(payload: LogPayload): Promise<void> {
    const enrichedPayload = {
      ...payload,
      sessionId: this.sessionId,
    };

    const isHighPriority =
      payload.level === 'WARN' || payload.level === 'ERROR' || payload.level === 'FATAL';

    if (isHighPriority) {
      this.queue.push(enrichedPayload);
      await this.flush();
    } else {
      this.queue.push(enrichedPayload);
      if (this.queue.length >= 50) {
        await this.flush();
      } else if (!this.flushTimer) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Schedules a background flush if not already scheduled.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }

  /**
   * Instantly flushes the in-memory queue to IndexedDB.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const batch = [...this.queue];
    this.queue = [];

    await this.writeLogsBatch(batch);
  }

  /**
   * Writes a batch of logs in a single transaction.
   */
  async writeLogsBatch(logs: LogPayload[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await runTransaction(this.db, 'logs', 'readwrite', (tx) => {
      const store = tx.objectStore('logs');
      for (const log of logs) {
        store.add(log);
      }
    });
  }

  /**
   * Retrieves all logs for a specific session.
   */
  async getLogsForSession(sessionId: string): Promise<LogPayload[]> {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction('logs', 'readonly');
    const store = transaction.objectStore('logs');
    const index = store.index('sessionId');
    return wrapRequest(index.getAll(IDBKeyRange.only(sessionId)));
  }

  /**
   * Retrieves all archived session records.
   */
  async getAllSessions(): Promise<SessionMetadata[]> {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction('sessions', 'readonly');
    const store = transaction.objectStore('sessions');
    const result = await wrapRequest(store.getAll());
    return result || [];
  }

  /**
   * Prunes older sessions, keeping maxArchivedSessions.
   * Protects active sessions in other tabs (updated in last 30s) and the current active session.
   */
  async pruneSessions(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sessions = await this.getAllSessions();
    if (sessions.length <= this.maxArchivedSessions) {
      return;
    }

    // Sort by createdAt ascending (oldest first)
    sessions.sort((a, b) => a.createdAt - b.createdAt);

    const now = Date.now();
    // Exclude active sessions:
    // 1. Current session
    // 2. Active sessions in other tabs (heartbeat within 2m / 120s)
    const candidates = sessions.filter((s) => {
      const isActiveSelf = s.id === this.sessionId;
      const isActiveOther = s.lastUpdated && now - s.lastUpdated < 120000;
      return !isActiveSelf && !isActiveOther;
    });

    const totalToPrune = sessions.length - this.maxArchivedSessions;
    if (totalToPrune <= 0) {
      return;
    }

    const sessionsToPrune = candidates.slice(0, totalToPrune);

    for (const session of sessionsToPrune) {
      const transaction = this.db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      await wrapRequest(store.delete(session.id));

      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction('logs', 'readwrite');
        const store = transaction.objectStore('logs');
        const index = store.index('sessionId');
        const request = index.openCursor(IDBKeyRange.only(session.id));

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    }
  }

  /**
   * Streams logs for a session via cursor.
   */
  async streamLogsForSession(sessionId: string, onLog: (log: LogPayload) => void): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction('logs', 'readonly');
      const store = transaction.objectStore('logs');
      const index = store.index('sessionId');
      const request = index.openCursor(IDBKeyRange.only(sessionId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          onLog(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Flushes outstanding logs, stops heartbeat, and closes connection.
   */
  async close(): Promise<void> {
    this.stopHeartbeat();
    await this.flush();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
