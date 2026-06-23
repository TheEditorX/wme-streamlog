import { LogStream, LogStreamConfig, UnifiedLogStreamConfig } from './core/LogStream.js';
import { ConsolePipe, ConsolePipeConfig } from './pipes/ConsolePipe.js';
import { IndexedDBPipe } from './pipes/IndexedDBPipe.js';
import { ZipStreamer } from './storage/ZipStreamer.js';
import { SessionManager, SessionManagerConfig } from './storage/SessionManager.js';
import { IndexedDBManager, IndexedDBManagerConfig } from './storage/IndexedDBManager.js';
import { LogPayload, LogLevel, SessionMetadata } from './core/LogPayload.js';

export { LogStream, ConsolePipe, IndexedDBPipe, ZipStreamer, SessionManager, IndexedDBManager };

export type {
  LogStreamConfig,
  UnifiedLogStreamConfig,
  ConsolePipeConfig,
  SessionManagerConfig,
  IndexedDBManagerConfig,
  LogPayload,
  LogLevel,
  SessionMetadata,
};
