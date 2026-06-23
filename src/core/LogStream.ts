import { create } from 'jsondiffpatch';
import { Dispatcher } from './Dispatcher.js';
import { BasePipe } from '../pipes/BasePipe.js';
import { LogPayload, LogLevel } from './LogPayload.js';
import { ConsolePipe, ConsolePipeConfig } from '../pipes/ConsolePipe.js';
import { IndexedDBPipe } from '../pipes/IndexedDBPipe.js';
import { IndexedDBManager } from '../storage/IndexedDBManager.js';
import { SessionManager } from '../storage/SessionManager.js';
import { ZipStreamer } from '../storage/ZipStreamer.js';

/**
 * Configuration options for the standard LogStream constructor.
 */
export interface LogStreamConfig {
  /** The minimum log level required for a log to be processed. Defaults to 'INFO'. */
  minLogLevel?: LogLevel;
  /** Custom base pipes to dispatch logs to. */
  pipes?: BasePipe[];
  /** Optional pre-configured IndexedDBManager to enable export and download methods. */
  dbManager?: IndexedDBManager;
}

/**
 * Configuration options for creating a WME LogStream using the simplified factory method.
 */
export interface UnifiedLogStreamConfig {
  /** The minimum log level required for a log to be processed. Defaults to 'INFO'. */
  minLogLevel?: LogLevel;
  /** Whether to enable IndexedDB persistence and multi-tab isolation. Defaults to false. */
  persist?: boolean;
  /** Unique database prefix identifier. Required if `persist` is true. */
  dbPrefix?: string;
  /** Current userscript or extension version. Required if `persist` is true. */
  scriptVersion?: string;
  /** Native WME SDK instance to defensively query editor versions. */
  wmeSDK?: any;
  /** Maximum number of completed archived database sessions to preserve. Defaults to 5. */
  maxArchivedSessions?: number;
  /** Delay in milliseconds before flushing logs in queue to IndexedDB. Defaults to 2000. */
  flushIntervalMs?: number;
  /** Custom console styling prefix and color options. Set to `null` to disable console logging. */
  brand?: ConsolePipeConfig | null;
}

const SEVERITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

function cloneDeep<T>(val: T): T {
  if (val === undefined) return undefined as any;
  if (typeof structuredClone !== 'undefined') {
    try {
      return structuredClone(val);
    } catch {
      // Fallback on serialization error
    }
  }
  return JSON.parse(JSON.stringify(val));
}

/**
 * Prunes an object to a maximum depth, stringifying any nested objects/arrays at that depth limit.
 */
function pruneToDepth(val: any, depth: number, maxDepth: number): any {
  if (typeof val !== 'object' || val === null) {
    return val;
  }
  if (depth >= maxDepth) {
    try {
      return JSON.stringify(val);
    } catch {
      return '[Object]';
    }
  }
  if (Array.isArray(val)) {
    return val.map((item) => pruneToDepth(item, depth + 1, maxDepth));
  }
  const result: any = {};
  for (const key of Object.keys(val)) {
    result[key] = pruneToDepth(val[key], depth + 1, maxDepth);
  }
  return result;
}

/**
 * The main logger class for WME LogStream.
 * Handles hierarchical scoping, console styling, state diff tracking, and persistent database exports.
 */
export class LogStream {
  private minLogLevel: LogLevel;
  private dispatcher: Dispatcher;
  private scopes: string[];
  private states: Map<string, any>;
  private patcher = create();
  private dbManagerPromise: Promise<IndexedDBManager> | null = null;

  /**
   * Initializes a LogStream instance.
   * Prefer using `LogStream.create()` for a simplified, zero-boilerplate setup.
   */
  constructor(
    config: LogStreamConfig,
    internal?: {
      dispatcher: Dispatcher;
      scopes: string[];
      states: Map<string, any>;
      dbManagerPromise?: Promise<IndexedDBManager> | null;
    },
  ) {
    this.minLogLevel = config.minLogLevel ?? 'INFO';
    if (internal) {
      this.dispatcher = internal.dispatcher;
      this.scopes = internal.scopes;
      this.states = internal.states;
      this.dbManagerPromise = internal.dbManagerPromise ?? null;
    } else {
      this.dispatcher = new Dispatcher();
      this.scopes = [];
      this.states = new Map();
      if (config.dbManager) {
        this.dbManagerPromise = Promise.resolve(config.dbManager);
      }
      if (config.pipes) {
        for (const pipe of config.pipes) {
          this.dispatcher.addPipe(pipe);
        }
      }
    }
  }

  /**
   * Synchronously creates a configured LogStream instance, initializing console outputs
   * and setting up background persistence/session managers if enabled.
   *
   * @param config The unified configuration options for console branding and persistence.
   * @returns A pre-configured LogStream instance ready to log immediately.
   */
  static create(config: UnifiedLogStreamConfig): LogStream {
    const pipes: BasePipe[] = [];
    let dbManagerPromise: Promise<IndexedDBManager> | null = null;

    if (config.brand !== null) {
      pipes.push(new ConsolePipe(config.brand));
    }

    if (config.persist) {
      if (!config.dbPrefix || !config.scriptVersion) {
        throw new Error('dbPrefix and scriptVersion are required when persist is true');
      }

      dbManagerPromise = (async () => {
        const sessionManager = new SessionManager({
          dbPrefix: config.dbPrefix!,
          scriptVersion: config.scriptVersion!,
          wmeSDK: config.wmeSDK,
        });

        const sessionId = await sessionManager.initSession();
        const wmeVersion = sessionManager.getWmeVersion();

        const dbManager = new IndexedDBManager({
          dbPrefix: config.dbPrefix!,
          scriptVersion: config.scriptVersion!,
          sessionId,
          wmeVersion,
          maxArchivedSessions: config.maxArchivedSessions,
          flushIntervalMs: config.flushIntervalMs,
        });

        await dbManager.init();
        await dbManager.pruneSessions();
        return dbManager;
      })();

      pipes.push(new IndexedDBPipe(dbManagerPromise));
    }

    const dispatcher = new Dispatcher();
    for (const pipe of pipes) {
      dispatcher.addPipe(pipe);
    }

    return new LogStream(
      {
        minLogLevel: config.minLogLevel,
      },
      {
        dispatcher,
        scopes: [],
        states: new Map(),
        dbManagerPromise,
      },
    );
  }

  /**
   * Spawns a child logger with a hierarchical scope prefix appended to the console/db entries.
   *
   * @param name The scope namespace (e.g. 'API', 'Auth').
   * @returns A new LogStream child instance carrying the hierarchical scope.
   */
  scope(name: string): LogStream {
    return new LogStream(
      { minLogLevel: this.minLogLevel },
      {
        dispatcher: this.dispatcher,
        scopes: [...this.scopes, name],
        states: this.states,
        dbManagerPromise: this.dbManagerPromise,
      },
    );
  }

  /** Logs a TRACE level message. */
  trace(message: string, data?: any): void {
    this.log('TRACE', message, data);
  }

  /** Logs a DEBUG level message. */
  debug(message: string, data?: any): void {
    this.log('DEBUG', message, data);
  }

  /** Logs an INFO level message. */
  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }

  /** Logs a WARN level message. */
  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }

  /** Logs an ERROR level message. */
  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }

  /** Logs a FATAL level message. */
  fatal(message: string, data?: any): void {
    this.log('FATAL', message, data);
  }

  /**
   * Compares the given state object against its previous version, calculating the deep-diff
   * and logging only modified properties as a DEBUG entry.
   *
   * @param name The state tracking key.
   * @param state The state object to track.
   * @param options Config options, e.g., max depth for nested objects.
   */
  stateDelta(name: string, state: any, options?: { maxDepth?: number }): void {
    const maxDepth = options?.maxDepth ?? 3;

    if (!this.states.has(name)) {
      this.states.set(name, cloneDeep(state));
      this.log('DEBUG', `State Delta: ${name} (initial)`, { delta: state });
      return;
    }

    const prevState = this.states.get(name);

    // Prune both objects up to maxDepth before diffing
    const prunedPrev = pruneToDepth(prevState, 0, maxDepth);
    const prunedState = pruneToDepth(state, 0, maxDepth);

    const delta = this.patcher.diff(prunedPrev, prunedState);

    if (delta !== undefined) {
      this.states.set(name, cloneDeep(state));
      this.log('DEBUG', `State Delta: ${name}`, { delta });
    }
  }

  /**
   * Returns a bound function that tracks changes to a specific state key over time.
   *
   * @param name The state tracking key.
   * @param options Config options, e.g., max depth for nested objects.
   * @returns A function accepting a state object to diff and log.
   */
  createStateTracker(name: string, options?: { maxDepth?: number }): (state: any) => void {
    return (state: any) => {
      this.stateDelta(name, state, options);
    };
  }

  /**
   * Asynchronously exports all stored database sessions and logs into a single compressed ZIP file.
   *
   * @returns A promise resolving to the compressed ZIP Blob.
   */
  async exportLogs(): Promise<Blob> {
    if (!this.dbManagerPromise) {
      throw new Error('Persistence (IndexedDB) is not enabled on this LogStream.');
    }
    const dbManager = await this.dbManagerPromise;
    const streamer = new ZipStreamer(dbManager);
    return streamer.exportAllSessions();
  }

  /**
   * Triggers a browser-native file download of the compressed log sessions.
   *
   * @param filename Custom download filename. Defaults to `wme-logs-<timestamp>.xlog`.
   */
  async downloadLogs(filename?: string): Promise<void> {
    const blob = await this.exportLogs();
    if (typeof document === 'undefined') {
      throw new Error('downloadLogs can only be called in a browser environment.');
    }
    const name = filename || `wme-logs-${Date.now()}.xlog`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Triggers a flush of all buffered logs on registered pipes.
   */
  async flush(): Promise<void> {
    await this.dispatcher.flush();
  }

  /**
   * Closes underlying active database connections if persistence is enabled.
   */
  async close(): Promise<void> {
    if (this.dbManagerPromise) {
      const dbManager = await this.dbManagerPromise;
      await dbManager.close();
    }
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (SEVERITY[level] < SEVERITY[this.minLogLevel]) {
      return;
    }

    const payload: LogPayload = {
      timestamp: Date.now(),
      level,
      scopes: [...this.scopes],
      message,
    };

    if (data !== undefined) {
      payload.data = data;
    }

    this.dispatcher.dispatch(payload);
  }
}
