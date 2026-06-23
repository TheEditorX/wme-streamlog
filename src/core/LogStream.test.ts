import { describe, it, expect, beforeEach } from 'vitest';
import { LogStream } from './LogStream.js';
import { BasePipe } from '../pipes/BasePipe.js';
import { LogPayload } from './LogPayload.js';

class MockPipe extends BasePipe {
  public logs: LogPayload[] = [];
  write(payload: LogPayload) {
    this.logs.push(payload);
  }
  flush() {}
}

describe('LogStream', () => {
  let mockPipe: MockPipe;
  let logger: LogStream;

  beforeEach(() => {
    mockPipe = new MockPipe();
  });

  it('should filter logs by minLogLevel', () => {
    logger = new LogStream({
      minLogLevel: 'INFO',
      pipes: [mockPipe],
    });

    logger.trace('trace log');
    logger.debug('debug log');
    logger.info('info log');
    logger.warn('warn log');

    expect(mockPipe.logs.length).toBe(2);
    expect(mockPipe.logs[0].level).toBe('INFO');
    expect(mockPipe.logs[0].message).toBe('info log');
    expect(mockPipe.logs[1].level).toBe('WARN');
    expect(mockPipe.logs[1].message).toBe('warn log');
  });

  it('should handle hierarchical scoping', () => {
    logger = new LogStream({
      minLogLevel: 'TRACE',
      pipes: [mockPipe],
    });

    const apiLogger = logger.scope('API');
    const authLogger = apiLogger.scope('Auth');

    logger.info('root log');
    apiLogger.info('api log');
    authLogger.info('auth log');

    expect(mockPipe.logs[0].scopes).toEqual([]);
    expect(mockPipe.logs[1].scopes).toEqual(['API']);
    expect(mockPipe.logs[2].scopes).toEqual(['API', 'Auth']);
  });

  it('should compute and log state deltas accurately', () => {
    logger = new LogStream({
      minLogLevel: 'TRACE',
      pipes: [mockPipe],
    });

    const stateKey = 'myState';

    // 1st call: Initial state
    logger.stateDelta(stateKey, { user: 'Alice', age: 25, settings: { theme: 'dark' } });
    expect(mockPipe.logs.length).toBe(1);
    expect(mockPipe.logs[0].message).toBe('State Delta: myState (initial)');
    expect(mockPipe.logs[0].data.delta).toEqual({
      user: 'Alice',
      age: 25,
      settings: { theme: 'dark' },
    });

    // 2nd call: No changes
    logger.stateDelta(stateKey, { user: 'Alice', age: 25, settings: { theme: 'dark' } });
    expect(mockPipe.logs.length).toBe(1); // No new log dispatched because no changes

    // 3rd call: Change simple property and nested property
    logger.stateDelta(stateKey, { user: 'Alice', age: 26, settings: { theme: 'light' } });
    expect(mockPipe.logs.length).toBe(2);
    expect(mockPipe.logs[1].message).toBe('State Delta: myState');
    expect(mockPipe.logs[1].data.delta).toEqual({
      age: [25, 26],
      settings: {
        theme: ['dark', 'light'],
      },
    });
  });

  it('should cap state delta depth recursion', () => {
    logger = new LogStream({
      minLogLevel: 'TRACE',
      pipes: [mockPipe],
    });

    const stateKey = 'nestedState';

    const state1 = {
      level1: {
        level2: {
          level3: {
            level4: 'deep value',
          },
        },
      },
    };

    const state2 = {
      level1: {
        level2: {
          level3: {
            level4: 'changed deep value',
          },
        },
      },
    };

    // Log with max depth 2 (level1 is depth 1, level2 is depth 2)
    logger.stateDelta(stateKey, state1, { maxDepth: 2 });
    mockPipe.logs = []; // Reset logs

    logger.stateDelta(stateKey, state2, { maxDepth: 2 });
    expect(mockPipe.logs.length).toBe(1);
    expect(mockPipe.logs[0].data.delta).toEqual({
      level1: {
        level2: [
          '{"level3":{"level4":"deep value"}}',
          '{"level3":{"level4":"changed deep value"}}',
        ],
      },
    });
  });
});
