import { BasePipe } from './BasePipe.js';
import { LogPayload, LogLevel } from '../core/LogPayload.js';

export interface ConsolePipeConfig {
  scriptPrefix?: string;
  brandColor?: string; // Hex color for the script prefix
}

export class ConsolePipe extends BasePipe {
  private scriptPrefix: string;
  private brandColor: string;

  private styles: Record<LogLevel, string> = {
    TRACE: 'color: #888888; font-weight: normal;',
    DEBUG: 'color: #03A9F4; font-weight: bold;',
    INFO: 'color: #4CAF50; font-weight: bold;',
    WARN: 'color: #FF9800; font-weight: bold;',
    ERROR: 'color: #F44336; font-weight: bold;',
    FATAL:
      'color: #FFFFFF; background-color: #B71C1C; font-weight: bold; padding: 2px 4px; border-radius: 2px;',
  };

  constructor(config?: ConsolePipeConfig) {
    super();
    this.scriptPrefix = config?.scriptPrefix ?? 'EditorX';
    this.brandColor = config?.brandColor ?? '#00E676';
  }

  write(payload: LogPayload): void {
    const timestampStr = new Date(payload.timestamp).toISOString().split('T')[1].slice(0, -1);
    const scopesStr = payload.scopes.map((s) => `[${s}]`).join('');
    const levelStr = payload.level;

    const prefixStyle = `color: ${this.brandColor}; font-weight: bold;`;
    const timeStyle = 'color: #9E9E9E;';
    const levelStyle = this.styles[levelStr];
    const scopeStyle = 'color: #9C27B0; font-weight: bold;';

    const format = `%c[${this.scriptPrefix}] %c${timestampStr} %c[${levelStr}]%c%c${scopesStr}%c ${payload.message}`;

    const args = [
      format,
      prefixStyle,
      timeStyle,
      levelStyle,
      '', // reset level style
      scopeStyle,
      '', // reset scope style
    ];

    if (payload.data !== undefined) {
      console.log(...args, payload.data);
    } else {
      console.log(...args);
    }
  }

  flush(): void {}
}
