import { LogPayload } from '../core/LogPayload.js';

export abstract class BasePipe {
  abstract write(payload: LogPayload): void | Promise<void>;
  abstract flush(): void | Promise<void>;
}
