import { parseRedisInfo } from './redis';

const INFO = [
  '# Memory',
  'used_memory:1048576',
  'used_memory_human:1.00M',
  'maxmemory:268435456',
  '',
  '# Clients',
  'connected_clients:7',
  '',
  '# Stats',
  'evicted_keys:3',
  'keyspace_hits:120',
  'keyspace_misses:30',
  '',
  '# Keyspace',
  'db0:keys=42,expires=5,avg_ttl=1000,subexpiry=0',
  'db3:keys=1,expires=0,avg_ttl=0,subexpiry=0',
].join('\r\n');

// @traces 878-FR-005
describe('parseRedisInfo', () => {
  it('reads memory, clients, evictions, hits, misses and keys by db', () => {
    expect(parseRedisInfo(INFO)).toEqual({
      clientsConnected: 7,
      evictedKeys: 3,
      keys: { '0': 42, '3': 1 },
      keyspaceHits: 120,
      keyspaceMisses: 30,
      memoryMaxBytes: 268_435_456,
      memoryUsedBytes: 1_048_576,
    });
  });

  it('reads a Redis with no memory limit as a maximum of 0', () => {
    const reading = parseRedisInfo(
      INFO.replace('maxmemory:268435456', 'maxmemory:0'),
    );
    expect(reading.memoryMaxBytes).toBe(0);
  });

  it('reads an empty keyspace as no db at all', () => {
    const reading = parseRedisInfo(INFO.split('# Keyspace')[0]);
    expect(reading.keys).toEqual({});
  });

  it('reads a field Redis leaves out as 0', () => {
    expect(parseRedisInfo('# Server\r\nredis_version:7.4.0\r\n')).toEqual({
      clientsConnected: 0,
      evictedKeys: 0,
      keys: {},
      keyspaceHits: 0,
      keyspaceMisses: 0,
      memoryMaxBytes: 0,
      memoryUsedBytes: 0,
    });
  });

  it('accepts plain newlines as well as CRLF', () => {
    expect(parseRedisInfo(INFO.replaceAll('\r\n', '\n')).clientsConnected).toBe(
      7,
    );
  });

  it('keeps only db0 to db15 as key labels', () => {
    const reading = parseRedisInfo(
      'db15:keys=2,expires=0\r\ndb99:keys=5\r\ndbx:keys=1\r\n',
    );
    expect(reading.keys).toEqual({ '15': 2 });
  });
});
