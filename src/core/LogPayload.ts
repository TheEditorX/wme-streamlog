export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogPayload {
  timestamp: number;
  level: LogLevel;
  scopes: string[];
  message: string;
  data?: any;
}

export interface SessionMetadata {
  id: string;
  createdAt: number;
  lastUpdated: number;
  scriptVersion: string;
  wmeVersion: string;
  loggerVersion: string;
  schemaVersion: string;
}
