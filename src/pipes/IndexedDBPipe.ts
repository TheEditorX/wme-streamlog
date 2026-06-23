import { BasePipe } from './BasePipe.js';
import { IndexedDBManager } from '../storage/IndexedDBManager.js';
import { LogPayload } from '../core/LogPayload.js';

export class IndexedDBPipe extends BasePipe {
  private dbManager: IndexedDBManager | null = null;
  private initPromise: Promise<IndexedDBManager> | null = null;
  private buffer: LogPayload[] = [];

  constructor(dbManagerOrPromise: IndexedDBManager | Promise<IndexedDBManager>) {
    super();
    if (dbManagerOrPromise instanceof Promise) {
      this.initPromise = dbManagerOrPromise.then((manager) => {
        this.dbManager = manager;
        for (const payload of this.buffer) {
          manager.writeLog(payload).catch(() => {});
        }
        this.buffer = [];
        return manager;
      });
    } else {
      this.dbManager = dbManagerOrPromise;
    }
  }

  async write(payload: LogPayload): Promise<void> {
    if (this.dbManager) {
      await this.dbManager.writeLog(payload);
    } else if (this.initPromise) {
      this.buffer.push(payload);
    }
  }

  async flush(): Promise<void> {
    if (this.dbManager) {
      await this.dbManager.flush();
    } else if (this.initPromise) {
      const manager = await this.initPromise;
      await manager.flush();
    }
  }
}
