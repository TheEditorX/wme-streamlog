import type { WmeSDK } from 'wme-sdk-typings';
import { generateSessionId } from '../utils/session.js';
import { EventChannel } from '../utils/EventChannel.js';
import { getWazeWindow } from '../utils/window.js';

export interface SessionManagerConfig {
  dbPrefix: string;
  scriptVersion: string;
  wmeSDK?: WmeSDK;
}

export class SessionManager {
  private dbPrefix: string;
  private scriptVersion: string;
  private wmeSDK?: WmeSDK;
  private sessionId: string | null = null;
  private tabId: string;
  private channel: EventChannel | null = null;

  constructor(config: SessionManagerConfig) {
    this.dbPrefix = config.dbPrefix;
    this.scriptVersion = config.scriptVersion;
    this.wmeSDK = config.wmeSDK;
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Initializes the session, handling tab isolation and duplicates.
   */
  async initSession(): Promise<string> {
    const channelName = `wme-logstream-tab-isolation-${this.dbPrefix}`;
    this.channel = new EventChannel(channelName);

    let candidateId = sessionStorage.getItem('wme_logstream_session_id');

    if (!candidateId || (await this._probeConflict(candidateId))) {
      candidateId = generateSessionId();
      sessionStorage.setItem('wme_logstream_session_id', candidateId);
    }

    this.sessionId = candidateId;

    // Listen to respond to other tabs' probes
    this.channel.subscribe<{ sessionId: string; tabId: string }>('PROBE', (payload) => {
      if (payload.sessionId === this.sessionId && payload.tabId !== this.tabId) {
        // Send conflict response
        this.channel?.publish('CONFLICT', {
          sessionId: this.sessionId,
        });
      }
    });

    return this.sessionId;
  }

  private async _probeConflict(sessionId = this.sessionId): Promise<boolean> {
    if (!sessionId || !this.channel) {
      throw new Error('Session has not been initialized or channel is closed.');
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 50);

      const unsubscribeConflict = this.channel!.subscribe<{ sessionId: string }>(
        'CONFLICT',
        (payload) => {
          if (payload.sessionId === sessionId) {
            unsubscribeConflict?.();
            clearTimeout(timeout);
            resolve(true);
          }
        },
      );

      this.channel!.publish('PROBE', {
        sessionId,
        tabId: this.tabId,
      });
    });
  }

  /**
   * Defensively extract the WME version from passed SDK or global window context.
   */
  getWmeVersion(): string | null {
    try {
      // 1. Try passed SDK
      if (typeof this.wmeSDK?.getWMEVersion === 'function') {
        return this.wmeSDK.getWMEVersion();
      }

      // 2. Try window.W.version or unsafeWindow.W.version via getWazeWindow
      const wazeWin = getWazeWindow();
      if (wazeWin?.W?.version) {
        return wazeWin.W.version;
      }
    } catch {
      // Safe fallback
    }
    return null;
  }

  /**
   * Returns current session ID if initialized
   */
  getSessionId(): string {
    if (!this.sessionId) {
      throw new Error('Session has not been initialized. Call initSession() first.');
    }
    return this.sessionId;
  }

  /**
   * Closes the session event channel
   */
  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
