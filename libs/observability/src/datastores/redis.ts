import { figure } from './figure';

export interface RedisReading {
  clientsConnected: number;
  evictedKeys: number;
  keys: Record<string, number>;
  keyspaceHits: number;
  keyspaceMisses: number;
  memoryMaxBytes: number;
  memoryUsedBytes: number;
}

// Reads the figures kept from Redis's INFO text. A field Redis leaves out
// reads as 0; keys are kept for db0 to db15 only, so the label stays small.
export function parseRedisInfo(info: string): RedisReading {
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0 && !line.startsWith('#')) {
      fields.set(line.slice(0, at), line.slice(at + 1));
    }
  }
  const number = (name: string) => figure(fields.get(name));
  const keys: Record<string, number> = {};
  for (const [name, value] of fields) {
    const db = /^db(\d{1,2})$/.exec(name)?.[1];
    if (db === undefined || Number(db) > 15) continue;
    keys[String(Number(db))] = figure(/(?:^|,)keys=(\d+)/.exec(value)?.[1]);
  }
  return {
    clientsConnected: number('connected_clients'),
    evictedKeys: number('evicted_keys'),
    keys,
    keyspaceHits: number('keyspace_hits'),
    keyspaceMisses: number('keyspace_misses'),
    memoryMaxBytes: number('maxmemory'),
    memoryUsedBytes: number('used_memory'),
  };
}
