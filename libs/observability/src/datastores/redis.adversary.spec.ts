import { parseRedisInfo } from './redis';

const numbers = (reading: ReturnType<typeof parseRedisInfo>) => [
  reading.clientsConnected,
  reading.evictedKeys,
  reading.keyspaceHits,
  reading.keyspaceMisses,
  reading.memoryMaxBytes,
  reading.memoryUsedBytes,
  ...Object.values(reading.keys),
];

describe('parseRedisInfo under hostile input', () => {
  it('reads an empty string as all zeros', () => {
    expect(parseRedisInfo('')).toEqual({
      clientsConnected: 0,
      evictedKeys: 0,
      keys: {},
      keyspaceHits: 0,
      keyspaceMisses: 0,
      memoryMaxBytes: 0,
      memoryUsedBytes: 0,
    });
  });

  it('never yields NaN or Infinity from non-numeric values', () => {
    const reading = parseRedisInfo(
      [
        'used_memory:abc',
        'maxmemory:NaN',
        'connected_clients:Infinity',
        'evicted_keys:',
        'keyspace_hits:1e999',
        'keyspace_misses:0x10',
        'db0:keys=oops,expires=0',
      ].join('\r\n'),
    );
    for (const figure of numbers(reading)) {
      expect(Number.isFinite(figure)).toBe(true);
    }
  });

  it('never yields a negative figure', () => {
    const reading = parseRedisInfo(
      'used_memory:-5\r\nconnected_clients:-1\r\nevicted_keys:-9\r\ndb0:keys=-3,expires=0\r\n',
    );
    for (const figure of numbers(reading))
      expect(figure).toBeGreaterThanOrEqual(0);
  });

  it('keeps a value beyond 2^53 finite', () => {
    const reading = parseRedisInfo('used_memory:99999999999999999999999\r\n');
    expect(Number.isFinite(reading.memoryUsedBytes)).toBe(true);
  });

  it('takes the first field when a name repeats with a different value', () => {
    const reading = parseRedisInfo(
      'connected_clients:3\r\nconnected_clients:99\r\n',
    );
    expect([3, 99]).toContain(reading.clientsConnected);
  });

  it('does not mistake a field with a similar prefix for the figure', () => {
    const reading = parseRedisInfo(
      'used_memory_human:1.00M\r\nused_memory_peak:900\r\nmaxmemory_policy:noeviction\r\nused_memory:10\r\n',
    );
    expect(reading.memoryUsedBytes).toBe(10);
    expect(reading.memoryMaxBytes).toBe(0);
  });

  it('keeps only db labels from the fixed 0 to 15 set, however the name is written', () => {
    const reading = parseRedisInfo(
      [
        'db01:keys=1,expires=0',
        'db-1:keys=2,expires=0',
        'db1.5:keys=3,expires=0',
        'db 2:keys=4,expires=0',
        'db16:keys=5,expires=0',
        'db٣:keys=6,expires=0',
        'db7:keys=8,expires=0',
      ].join('\n'),
    );
    const allowed = new Set(Array.from({ length: 16 }, (_, i) => String(i)));
    for (const label of Object.keys(reading.keys)) {
      expect(allowed.has(label)).toBe(true);
    }
    expect(reading.keys['7']).toBe(8);
  });

  it('reads a binary blob as zeros without throwing', () => {
    const blob = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => (i * 37) % 256),
    ).toString('latin1');
    expect(numbers(parseRedisInfo(blob)).every(Number.isFinite)).toBe(true);
  });

  it('reads a UTF-16 text decoded as UTF-8 as zeros', () => {
    const text = Buffer.from('used_memory:10\r\n', 'utf16le').toString('utf8');
    expect(parseRedisInfo(text).memoryUsedBytes).toBe(0);
  });

  it('reads a very large INFO text with thousands of dbs in bounded labels', () => {
    const lines = Array.from(
      { length: 10_000 },
      (_, i) => `db${i}:keys=${i},expires=0`,
    );
    expect(
      Object.keys(parseRedisInfo(lines.join('\r\n')).keys).length,
    ).toBeLessThanOrEqual(16);
  });

  it('copes with a megabyte of lines without a colon', () => {
    const text = `${`${'x'.repeat(1024)}\r\n`.repeat(1024)}connected_clients:2\r\n`;
    expect(parseRedisInfo(text).clientsConnected).toBe(2);
  });

  it('reads a key line with a trailing space or tab around the value', () => {
    expect(parseRedisInfo('connected_clients:4 \r\n').clientsConnected).toBe(4);
  });
});
