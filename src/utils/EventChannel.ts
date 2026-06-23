export interface EventChannelMessage<T = any> {
  type: string;
  payload: T;
}

export class EventChannel {
  private channel: BroadcastChannel;
  private listeners = new Map<string, Set<(payload: any) => void>>();

  constructor(name: string) {
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data as EventChannelMessage;
      if (data && typeof data.type === 'string') {
        const callbacks = this.listeners.get(data.type);
        if (callbacks) {
          for (const callback of callbacks) {
            try {
              callback(data.payload);
            } catch (e) {
              console.error('Error in EventChannel callback:', e);
            }
          }
        }
      }
    };
  }

  /**
   * Publishes an event to the BroadcastChannel.
   */
  publish<T>(type: string, payload: T): void {
    this.channel.postMessage({ type, payload });
  }

  /**
   * Subscribes to a specific event type. Returns an unsubscribe function.
   */
  subscribe<T>(type: string, callback: (payload: T) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
    return () => {
      const callbacks = this.listeners.get(type);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }

  /**
   * Closes the underlying BroadcastChannel.
   */
  close(): void {
    this.channel.close();
    this.listeners.clear();
  }
}
