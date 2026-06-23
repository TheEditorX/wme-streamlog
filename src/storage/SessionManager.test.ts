import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from './SessionManager.js';
import { EventChannel } from '../utils/EventChannel.js';
import { WmeSDK } from 'wme-sdk-typings';

describe('SessionManager', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('should generate a new Session ID if none exists in sessionStorage', async () => {
    const manager = new SessionManager({ dbPrefix: 'Speedster', scriptVersion: '1.0.0' });
    const sessionId = await manager.initSession();
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe('string');
    expect(sessionStorage.getItem('wme_logstream_session_id')).toBe(sessionId);
  });

  it('should reuse existing Session ID on normal reload if no conflict', async () => {
    sessionStorage.setItem('wme_logstream_session_id', 'test_session_123');
    const manager = new SessionManager({ dbPrefix: 'Speedster', scriptVersion: '1.0.0' });
    const sessionId = await manager.initSession();
    expect(sessionId).toBe('test_session_123');
  });

  it('should resolve session ID conflict when tab is cloned', async () => {
    // Simulating another active tab with the same session ID
    sessionStorage.setItem('wme_logstream_session_id', 'duplicate_session');

    // Create an EventChannel in the test to simulate the other tab responding
    const channel = new EventChannel('wme-logstream-tab-isolation-Speedster');
    channel.subscribe<{ sessionId: string; tabId: string }>('PROBE', (payload) => {
      if (payload.sessionId === 'duplicate_session') {
        channel.publish('CONFLICT', { sessionId: 'duplicate_session' });
      }
    });

    const manager = new SessionManager({ dbPrefix: 'Speedster', scriptVersion: '1.0.0' });
    const sessionId = await manager.initSession();

    expect(sessionId).not.toBe('duplicate_session');
    expect(sessionId).toBeDefined();
    expect(sessionStorage.getItem('wme_logstream_session_id')).toBe(sessionId);

    channel.close();
  });

  it('should defensively extract WME version', () => {
    const manager = new SessionManager({ dbPrefix: 'Speedster', scriptVersion: '1.0.0' });

    // Case 1: All undefined
    expect(manager.getWmeVersion()).toBeNull();

    // Case 2: Custom wmeSDK is passed via options
    const mockSdk = { getWMEVersion: () => '1.2.3' } as WmeSDK;
    const managerWithSdk = new SessionManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      wmeSDK: mockSdk,
    });
    expect(managerWithSdk.getWmeVersion()).toBe('1.2.3');

    // Case 3: window.W is available
    (global as any).window = {
      W: { version: '4.5.6' },
    } as any;
    expect(manager.getWmeVersion()).toBe('4.5.6');
    delete (global as any).window.W;

    // Case 4: unsafeWindow.W is available
    (global as any).unsafeWindow = {
      W: { version: '7.8.9' },
    };
    expect(manager.getWmeVersion()).toBe('7.8.9');
    delete (global as any).unsafeWindow;
  });
});
