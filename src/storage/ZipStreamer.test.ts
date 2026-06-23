import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBManager } from './IndexedDBManager.js';
import { ZipStreamer } from './ZipStreamer.js';
import * as fflate from 'fflate';
import { SessionMetadata } from '../core/LogPayload.js';

describe('ZipStreamer', () => {
  let manager: IndexedDBManager;

  beforeEach(async () => {
    manager = new IndexedDBManager({
      dbPrefix: 'Speedster',
      scriptVersion: '1.0.0',
      sessionId: 'session_active',
      wmeVersion: '2.0.0',
    });
    await manager.init();
  });

  afterEach(async () => {
    await manager.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('LogStreamDB_Speedster');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  it('should export all sessions to a valid zip Blob', async () => {
    const session1: SessionMetadata = {
      id: 'session_1',
      createdAt: 1000,
      lastUpdated: 1000,
      scriptVersion: '1.0.0',
      wmeVersion: '2.0.0',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };
    const session2: SessionMetadata = {
      id: 'session_2',
      createdAt: 2000,
      lastUpdated: 2000,
      scriptVersion: '1.1.0',
      wmeVersion: '2.0.1',
      loggerVersion: '1.0.0',
      schemaVersion: '1.0.0',
    };

    await manager.saveSessionMetadata(session1);
    await manager.saveSessionMetadata(session2);

    await manager.writeLogsBatch([
      {
        timestamp: 1005,
        level: 'INFO',
        scopes: ['API'],
        message: 'Session 1 log A',
        sessionId: 'session_1',
      } as any,
      {
        timestamp: 1010,
        level: 'DEBUG',
        scopes: ['DB'],
        message: 'Session 1 log B',
        sessionId: 'session_1',
      } as any,
    ]);

    await manager.writeLogsBatch([
      {
        timestamp: 2005,
        level: 'WARN',
        scopes: ['UI'],
        message: 'Session 2 log A',
        sessionId: 'session_2',
      } as any,
    ]);

    const streamer = new ZipStreamer(manager);
    const blob = await streamer.exportAllSessions();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');

    // Convert Blob to Buffer using FileReader (to be safe in jsdom)
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });

    const unzipped = fflate.unzipSync(new Uint8Array(arrayBuffer));

    expect(unzipped['session_1/details.json']).toBeDefined();
    expect(unzipped['session_1/logs.json']).toBeDefined();

    const details1 = JSON.parse(new TextDecoder().decode(unzipped['session_1/details.json']));
    expect(details1.id).toBe('session_1');
    expect(details1.scriptVersion).toBe('1.0.0');

    const logs1 = JSON.parse(new TextDecoder().decode(unzipped['session_1/logs.json']));
    expect(logs1.length).toBe(2);
    expect(logs1[0].message).toBe('Session 1 log A');
    expect(logs1[1].message).toBe('Session 1 log B');

    expect(unzipped['session_2/details.json']).toBeDefined();
    expect(unzipped['session_2/logs.json']).toBeDefined();

    const details2 = JSON.parse(new TextDecoder().decode(unzipped['session_2/details.json']));
    expect(details2.id).toBe('session_2');
    expect(details2.scriptVersion).toBe('1.1.0');

    const logs2 = JSON.parse(new TextDecoder().decode(unzipped['session_2/logs.json']));
    expect(logs2.length).toBe(1);
    expect(logs2[0].message).toBe('Session 2 log A');
  });
});
