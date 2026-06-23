// Simple BroadcastChannel polyfill for JSDOM
class MockBroadcastChannel {
  name: string;
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;
  private static channels = new Map<string, Set<MockBroadcastChannel>>();

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }

  postMessage(message: any) {
    const listeners = MockBroadcastChannel.channels.get(this.name);
    if (listeners) {
      // Fire onmessage asynchronously to match real BroadcastChannel behavior
      setTimeout(() => {
        for (const listener of listeners) {
          if (listener !== this && listener.onmessage) {
            listener.onmessage({
              data: message,
              origin: '',
              lastEventId: '',
              source: null,
              ports: [],
            } as any);
          }
        }
      }, 0);
    }
  }

  close() {
    const listeners = MockBroadcastChannel.channels.get(this.name);
    if (listeners) {
      listeners.delete(this);
      if (listeners.size === 0) {
        MockBroadcastChannel.channels.delete(this.name);
      }
    }
  }
}

if (typeof window !== 'undefined' && !window.BroadcastChannel) {
  (window as any).BroadcastChannel = MockBroadcastChannel;
}
if (typeof global !== 'undefined' && !(global as any).BroadcastChannel) {
  (global as any).BroadcastChannel = MockBroadcastChannel as any;
}
