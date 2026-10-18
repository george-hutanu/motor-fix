import {
  type MonitorSession,
  observeDataStores,
  telemetryStarted,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Pool } from 'pg';

import { oldestPendingSeconds } from './outbox-age';
import { borrowStore, returnStore } from '../store/store';

const DATA_STORE_CLIENTS = Symbol('DATA_STORE_CLIENTS');
const DATA_STORE_INTERVAL = Symbol('DATA_STORE_INTERVAL');
const STATEMENT_LIMIT_MS = 5_000;
const KEYCLOAK_LIMIT_MS = 5_000;

interface DataStoreOptions {
  // The application URL, for the outbox SELECT.
  databaseUrl: string;
  // How often the stores are read; 60 s when unset.
  intervalMs?: number;
  // KEYCLOAK_METRICS_URL; unset or empty, the Keycloak reading is off.
  keycloakMetricsUrl?: string;
  // MONITOR_DATABASE_URL; unset, the PostgreSQL readings are off.
  monitorUrl?: string;
  redisUrl: string;
}

interface Clients {
  // Keycloak's management /metrics address; absent without
  // KEYCLOAK_METRICS_URL.
  keycloak?: string;
  // The application database, one connection, for the outbox SELECT.
  outbox: Pool;
  // The monitoring role's session; absent without MONITOR_DATABASE_URL.
  pool?: Pool;
  redis: Redis;
}

// Each client fails on its own and the readings report it, so their error
// events are not logged again here.
const ignore = () => undefined;

// One connection that gives up on connecting or on a statement within the
// reading's limit, so a database that stops answering holds no more.
function bounded(connectionString: string, extra: { options?: string } = {}) {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: STATEMENT_LIMIT_MS,
    max: 1,
    statement_timeout: STATEMENT_LIMIT_MS,
    ...extra,
  });
  pool.on('error', ignore);
  return pool;
}

// What a failed fetch or read is reported as: its code or its kind, never
// its message, which may name the address.
function reason(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'fetch failed';
  const { cause, name } = error as {
    cause?: { code?: unknown };
    name?: unknown;
  };
  if (typeof cause?.code === 'string') return cause.code;
  return typeof name === 'string' && name !== '' ? name : 'fetch failed';
}

// One GET of Keycloak's metrics text within the reading's limit. A failure
// names its status, code or kind only, never the address.
// Keycloak's metrics text is a few hundred kB; a declared body past this
// is refused unread.
const MAX_METRICS_BYTES = 8 * 1024 * 1024;

async function readMetrics(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(KEYCLOAK_LIMIT_MS),
    });
  } catch (error) {
    throw new Error(reason(error));
  }
  if (!response.ok) {
    await response.body?.cancel().catch(ignore);
    throw new Error(`HTTP ${response.status}`);
  }
  const length = Number(response.headers?.get('content-length'));
  if (length > MAX_METRICS_BYTES) {
    await response.body?.cancel().catch(ignore);
    throw new Error('metrics body too large');
  }
  try {
    return await response.text();
  } catch (error) {
    throw new Error(reason(error));
  }
}

const session = (pool: Pool): MonitorSession => ({
  query: async <T>(text: string) => (await pool.query(text)).rows as T[],
});

function connect(options: DataStoreOptions): Clients | undefined {
  if (!telemetryStarted()) return undefined;
  const pool =
    options.monitorUrl === undefined || options.monitorUrl === ''
      ? undefined
      : bounded(options.monitorUrl, {
          options: '-c default_transaction_read_only=on',
        });
  const redis = borrowStore(options.redisUrl);
  const keycloak = options.keycloakMetricsUrl || undefined;
  // A malformed address fails the boot, not every reading.
  if (keycloak) new URL(keycloak);
  return { keycloak, outbox: bounded(options.databaseUrl), pool, redis };
}

// The worker's readings of PostgreSQL (as the monitoring role), Redis, the
// outbox and Keycloak's heap for the data-store figures. Off, holding no
// client, while telemetry is off.
@Module({})
export class DataStoreMetricsModule
  implements OnModuleInit, OnApplicationShutdown
{
  private stop: (() => void) | undefined;

  constructor(
    @Inject(DATA_STORE_CLIENTS) private readonly clients: Clients | undefined,
    @Inject(DATA_STORE_INTERVAL)
    private readonly intervalMs: number | undefined,
  ) {}

  static register(options: DataStoreOptions): DynamicModule {
    return {
      module: DataStoreMetricsModule,
      providers: [
        { provide: DATA_STORE_CLIENTS, useFactory: () => connect(options) },
        { provide: DATA_STORE_INTERVAL, useValue: options.intervalMs },
      ],
    };
  }

  onModuleInit() {
    const clients = this.clients;
    if (!clients) return;
    const { keycloak, outbox, pool, redis } = clients;
    this.stop = observeDataStores({
      ...(this.intervalMs && { intervalMs: this.intervalMs }),
      outbox: {
        oldestPendingSeconds: () => oldestPendingSeconds(session(outbox)),
      },
      ...(keycloak && { keycloak: { metrics: () => readMetrics(keycloak) } }),
      ...(pool && { postgres: session(pool) }),
      redis: { info: () => redis.info() },
    });
  }

  async onApplicationShutdown() {
    this.stop?.();
    const clients = this.clients;
    if (!clients) return;
    await returnStore(clients.redis);
    await Promise.allSettled([clients.pool?.end(), clients.outbox.end()]);
  }
}
