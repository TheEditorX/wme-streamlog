import { describe, it, expect, afterEach, vi } from 'vitest';
import { LogStream } from './LogStream.js';
import * as fflate from 'fflate';

describe('LogStream Simplified API', () => {
  const dbPrefix = 'SimplifiedTest';
  let activeLogger: LogStream | null = null;

  afterEach(async () => {
    if (activeLogger) {
      await activeLogger.close();
      activeLogger = null;
    }
    vi.restoreAllMocks();
    // Delete database to avoid leaks
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(`LogStreamDB_${dbPrefix}`);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    sessionStorage.clear();
  });

  it('should initialize a ConsolePipe via LogStream.create', () => {
    activeLogger = LogStream.create({
      minLogLevel: 'DEBUG',
      brand: {
        scriptPrefix: 'BrandTest',
        brandColor: '#ff0000',
      },
    });

    expect(activeLogger).toBeInstanceOf(LogStream);

    // Call logger methods to verify no exceptions
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    activeLogger.info('test console message');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should support state tracking wrapper', () => {
    activeLogger = LogStream.create({
      minLogLevel: 'DEBUG',
      brand: { scriptPrefix: 'TrackerTest' },
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const track = activeLogger.createStateTracker('testState');

    // First call: initial state
    track({ key: 'val1' });
    expect(consoleSpy).toHaveBeenCalled();
    const callCount = consoleSpy.mock.calls.length;

    // Second call: no change, should not call console.log
    track({ key: 'val1' });
    expect(consoleSpy.mock.calls.length).toBe(callCount);

    // Third call: changed state, should call console.log
    track({ key: 'val2' });
    expect(consoleSpy.mock.calls.length).toBeGreaterThan(callCount);
  });

  it('should buffer logs during async persistence setup and write them to IndexedDB', async () => {
    activeLogger = LogStream.create({
      minLogLevel: 'DEBUG',
      persist: true,
      dbPrefix,
      scriptVersion: '1.2.3',
      flushIntervalMs: 50,
      brand: null, // skip ConsolePipe
    });

    // Log immediately, before DB is ready
    activeLogger.info('buffered log 1');
    activeLogger.debug('buffered log 2');

    // Wait for internal DB initialization to resolve
    await activeLogger.flush();

    // Export logs to verify they were written to IndexedDB
    const blob = await activeLogger.exportLogs();
    expect(blob).toBeInstanceOf(Blob);

    const arrayBuffer = await blob.arrayBuffer();
    const unzipped = fflate.unzipSync(new Uint8Array(arrayBuffer));

    // There should be a session folder with details.json and logs.json
    const fileKeys = Object.keys(unzipped);
    const detailsKey = fileKeys.find((k) => k.endsWith('details.json'));
    const logsKey = fileKeys.find((k) => k.endsWith('logs.json'));

    expect(detailsKey).toBeDefined();
    expect(logsKey).toBeDefined();

    const details = JSON.parse(new TextDecoder().decode(unzipped[detailsKey!]));
    expect(details.scriptVersion).toBe('1.2.3');

    const logs = JSON.parse(new TextDecoder().decode(unzipped[logsKey!]));
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe('buffered log 1');
    expect(logs[1].message).toBe('buffered log 2');
  });

  it('should download logs in browser environment', async () => {
    activeLogger = LogStream.create({
      persist: true,
      dbPrefix,
      scriptVersion: '1.0.0',
      brand: null,
    });

    activeLogger.info('log to download');
    await activeLogger.flush();

    // Mock document.createElement and click
    const mockElement = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(mockElement as any);
    const createObjectURLMock = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURLMock = vi.fn();

    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });

    await activeLogger.downloadLogs('test-download.zip');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockElement.download).toBe('test-download.zip');
    expect(mockElement.click).toHaveBeenCalled();
  });
});
