import { BasePipe } from '../pipes/BasePipe.js';
import { LogPayload } from './LogPayload.js';

export class Dispatcher {
  private pipes: BasePipe[] = [];

  addPipe(pipe: BasePipe): void {
    this.pipes.push(pipe);
  }

  dispatch(payload: LogPayload): void {
    for (const pipe of this.pipes) {
      try {
        const result = pipe.write(payload);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error('Error writing to pipe:', err);
          });
        }
      } catch (err) {
        console.error('Error writing to pipe:', err);
      }
    }
  }

  async flush(): Promise<void> {
    const flushPromises = this.pipes.map(async (pipe) => {
      try {
        await pipe.flush();
      } catch (err) {
        console.error('Error flushing pipe:', err);
      }
    });
    await Promise.all(flushPromises);
  }
}
