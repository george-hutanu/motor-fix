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
import { Redis } from 'ioredis';
import { Pool } from 'pg';

import { oldestPendingSeconds } from './outbox-age';

const DATA_STORE_CLIENTS = Symbol('DATA_STORE_CLIENTS');
const DATA_STORE_INTERVAL = Symbol('DATA_STORE_INTERVAL');
const LIMIT_MS = 2_000;
const STATEMENT_LIMIT_MS = 5_000;

interface DataStoreOptions {
  // The application URL, for the outbox SELECT.
  databaseUrl: string;
  // How often the stores are read; 60 s when unset.
  intervalMs?: number;
  // MONITOR_DATABASE_URL; unset, the PostgreSQL readings are off.
  monitorUrl?: string;
  redisUrl: string;
}

interface Clients {
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
  const redis = new Redis(options.redisUrl, {
    commandTimeout: LIMIT_MS,
    connectTimeout: LIMIT_MS,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', ignore);
  return { outbox: bounded(options.databaseUrl), pool, redis };
}

// The worker's readings of PostgreSQL (as the monitoring role), Redis and
// the outbox for the data-store figures. Off, holding no client, while
// telemetry is off.
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
    const { outbox, pool, redis } = clients;
    this.stop = observeDataStores({
      ...(this.intervalMs && { intervalMs: this.intervalMs }),
      outbox: {
        oldestPendingSeconds: () => oldestPendingSeconds(session(outbox)),
      },
      ...(pool && { postgres: session(pool) }),
      redis: {
        info: async () => {
          if (redis.status === 'wait') await redis.connect();
          return redis.info();
        },
      },
    });
  }

  async onApplicationShutdown() {
    this.stop?.();
    const clients = this.clients;
    if (!clients) return;
    clients.redis.disconnect();
    await Promise.allSettled([clients.pool?.end(), clients.outbox.end()]);
  }
}
