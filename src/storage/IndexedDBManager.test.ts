import { describe, it, expect, afterEach, vi } from 'vitest';
import { IndexedDBManager } from './IndexedDBManager.js';
import { LogPayload, SessionMetadata } from '../core/LogPayload.js';
import { openDB } from '../utils/idb.js';

describe('IndexedDBManager', () => {
  let manager: IndexedDBManager | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    if (manager) {
      await manager.close();
      manager = null;
    }
    // Delete database to avoid leaks
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('LogStreamDB_Speedster');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  it('should initialize database with correct prefix', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_1',
      maxArchivedSessions: 3,
      wmeVersion: '2.0.0',
    });
    expect(manager.getDatabaseName()).toBe('LogStreamDB_Speedster');

    await manager.init();
    const sessions = await manager.getAllSessions();
    expect(sessions).toBeDefined();
  });

  it('should buffer TRACE, DEBUG, INFO logs and flush after the specified interval', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_1',
      wmeVersion: '2.0.0',
      flushIntervalMs: 50,
    });
    await manager.init();

    const payload: LogPayload = {
      timestamp: Date.now(),
      level: 'INFO',
      scopes: ['TEST'],
      message: 'test log message',
    };

    await manager.writeLog(payload);

    // Verify it is not written to DB yet (should be empty/buffered)
    let logs = await manager.getLogsForSession('session_1');
    expect(logs.length).toBe(0);

    // Wait for the flush interval to pass (50ms config, wait 100ms)
    await new Promise((resolve) => setTimeout(resolve, 100));

    logs = await manager.getLogsForSession('session_1');
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe('test log message');
  });

  it('should flush logs when buffer reaches 50 logs', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_1',
      wmeVersion: '2.0.0',
    });
    await manager.init();

    // Write 49 logs (should not flush)
    for (let i = 0; i < 49; i++) {
      await manager.writeLog({
        timestamp: Date.now(),
        level: 'DEBUG',
        scopes: ['TEST'],
        message: `log ${i}`,
      });
    }

    let logs = await manager.getLogsForSession('session_1');
    expect(logs.length).toBe(0);

    // Write 50th log (should trigger flush immediately)
    await manager.writeLog({
      timestamp: Date.now(),
      level: 'DEBUG',
      scopes: ['TEST'],
      message: 'log 50',
    });

    logs = await manager.getLogsForSession('session_1');
    expect(logs.length).toBe(50);
  });

  it('should instantly write WARN, ERROR, FATAL logs bypassing the queue', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_1',
      wmeVersion: '2.0.0',
    });
    await manager.init();

    // Write a low-priority log (buffered)
    await manager.writeLog({
      timestamp: Date.now(),
      level: 'INFO',
      scopes: ['TEST'],
      message: 'buffered info',
    });

    // Write a high-priority log (instant flush)
    await manager.writeLog({
      timestamp: Date.now(),
      level: 'ERROR',
      scopes: ['TEST'],
      message: 'instant error',
    });

    // Both should be in DB now because the ERROR flush writes the queue
    const logs = await manager.getLogsForSession('session_1');
    expect(logs.length).toBe(2);
    expect(logs.some((l) => l.level === 'INFO')).toBe(true);
    expect(logs.some((l) => l.level === 'ERROR')).toBe(true);
  });

  it('should preserve log order when a high-priority log forces an instant flush', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_1',
      wmeVersion: '2.0.0',
    });
    await manager.init();

    // Write low-priority log first
    await manager.writeLog({
      timestamp: 1000,
      level: 'INFO',
      scopes: ['TEST'],
      message: 'first (low-priority)',
    });

    // Write high-priority log second
    await manager.writeLog({
      timestamp: 1001,
      level: 'ERROR',
      scopes: ['TEST'],
      message: 'second (high-priority)',
    });

    const logs = await manager.getLogsForSession('session_1');
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe('first (low-priority)');
    expect(logs[1].message).toBe('second (high-priority)');
  });

  it('should prune old sessions exceeding maxArchivedSessions', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_3', // Current session
      maxArchivedSessions: 2,
      wmeVersion: '2.0.0',
    });
    await manager.init();

    // Insert mock old sessions
    const oldSession1: SessionMetadata = {
      id: 'session_1',
      createdAt: Date.now() - 180000,
      lastUpdated: Date.now() - 180000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    const oldSession2: SessionMetadata = {
      id: 'session_2',
      createdAt: Date.now() - 170000,
      lastUpdated: Date.now() - 170000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    await manager.saveSessionMetadata(oldSession1);
    await manager.saveSessionMetadata(oldSession2);

    // Insert mock logs
    await manager.writeLogsBatch([
      {
        timestamp: Date.now(),
        level: 'INFO',
        scopes: ['TEST'],
        message: 'log 1',
        sessionId: 'session_1',
      } as any,
    ]);
    await manager.writeLogsBatch([
      {
        timestamp: Date.now(),
        level: 'INFO',
        scopes: ['TEST'],
        message: 'log 2',
        sessionId: 'session_2',
      } as any,
    ]);

    // Write current session log (instant via WARN)
    await manager.writeLog({
      timestamp: Date.now(),
      level: 'WARN',
      scopes: ['TEST'],
      message: 'log 3',
    });

    await manager.pruneSessions();

    const sessions = await manager.getAllSessions();
    expect(sessions.length).toBe(2);
    expect(sessions.find((s) => s.id === 'session_1')).toBeUndefined();
    expect(sessions.find((s) => s.id === 'session_2')).toBeDefined();
    expect(sessions.find((s) => s.id === 'session_3')).toBeDefined();

    const logs1 = await manager.getLogsForSession('session_1');
    expect(logs1.length).toBe(0);

    const logs2 = await manager.getLogsForSession('session_2');
    expect(logs2.length).toBe(1);

    const logs3 = await manager.getLogsForSession('session_3');
    expect(logs3.length).toBe(1);
  });

  it('should exclude currently active session from pruning even if it is the oldest', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_active', // Currently active session
      maxArchivedSessions: 2,
      wmeVersion: '2.0.0',
    });
    await manager.init();

    // session_1: oldest session (should be pruned)
    const oldSession1: SessionMetadata = {
      id: 'session_1',
      createdAt: Date.now() - 180000,
      lastUpdated: Date.now() - 180000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    // session_3: newest session
    const oldSession3: SessionMetadata = {
      id: 'session_3',
      createdAt: Date.now() - 170000,
      lastUpdated: Date.now() - 170000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    await manager.saveSessionMetadata(oldSession1);
    await manager.saveSessionMetadata(oldSession3);

    // Call prune
    await manager.pruneSessions();

    const sessions = await manager.getAllSessions();
    expect(sessions.length).toBe(2);
    // session_1 (oldest) should be pruned
    expect(sessions.find((s) => s.id === 'session_1')).toBeUndefined();
    // session_active (active) must be preserved
    expect(sessions.find((s) => s.id === 'session_active')).toBeDefined();
    // session_3 (newest) must be preserved
    expect(sessions.find((s) => s.id === 'session_3')).toBeDefined();
  });

  it('should exclude active sessions in other tabs from pruning', async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_active',
      maxArchivedSessions: 2,
      wmeVersion: '2.0.0',
    });
    await manager.init();

    // session_stale: oldest, last updated 3 minutes ago (should be pruned)
    const sessionStale: SessionMetadata = {
      id: 'session_stale',
      createdAt: Date.now() - 200000,
      lastUpdated: Date.now() - 180000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    // session_other_active: second oldest, last updated 5 seconds ago (should be preserved)
    const sessionOtherActive: SessionMetadata = {
      id: 'session_other_active',
      createdAt: Date.now() - 20000,
      lastUpdated: Date.now() - 5000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    await manager.saveSessionMetadata(sessionStale);
    await manager.saveSessionMetadata(sessionOtherActive);

    // Call prune
    await manager.pruneSessions();

    const sessions = await manager.getAllSessions();
    expect(sessions.length).toBe(2);
    // session_stale (stale) should be pruned
    expect(sessions.find((s) => s.id === 'session_stale')).toBeUndefined();
    // session_active (active self) must be preserved
    expect(sessions.find((s) => s.id === 'session_active')).toBeDefined();
    // session_other_active (active other tab) must be preserved
    expect(sessions.find((s) => s.id === 'session_other_active')).toBeDefined();
  });

  it('should call onBlocked option when opening database is blocked', async () => {
    const dbName = 'LogStreamDB_Blocked_Test';
    // Clean up if database exists
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });

    const db1 = await openDB(dbName, 1);

    let blockedTriggered = false;
    const db2 = await openDB(dbName, 2, {
      onBlocked: () => {
        blockedTriggered = true;
        db1.close();
      },
    });

    expect(blockedTriggered).toBe(true);

    db2.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });
});
