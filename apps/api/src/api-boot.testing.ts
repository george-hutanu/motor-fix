import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { databaseTurn, S3TestStore } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

export const TEST_TOKEN_SECRET = 'test-secret';

// Boots the API as production sets it up, against its own object store, once
// the database turn is ours: the domain specs empty the account tables
// meanwhile. stop() gives everything back from whatever stage start() reached.
export function apiBoot() {
  const env = {
    APP_ENV: 'test',
    AUTH_TOKEN_SECRET: TEST_TOKEN_SECRET,
    DATABASE_URL:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
    REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    RELEASE_SHA: 'abc123',
  };
  const store = new S3TestStore();
  const turn = databaseTurn(env.DATABASE_URL);
  let app: INestApplication | undefined;
  let storeStarted = false;
  let stopped = false;

  async function giveBack(): Promise<void> {
    // Async wrappers turn a synchronous throw into a rejection.
    const closes: (() => Promise<unknown>)[] = [];
    const started = app;
    if (started) closes.push(async () => started.close());
    if (storeStarted) closes.push(async () => store.stop());
    app = undefined;
    storeStarted = false;
    const failures: unknown[] = [];
    try {
      for (const close of closes) {
        await close().catch((error: unknown) => failures.push(error));
      }
    } finally {
      await turn.release();
    }
    if (failures.length > 0) throw failures[0];
  }

  // stop() may run while start() still waits (a beforeAll that timed out):
  // whatever start() reaches afterwards is given back, not left open.
  async function unlessStopped(): Promise<void> {
    if (!stopped) return;
    await giveBack();
    throw new Error('the API boot was stopped before it finished');
  }

  return {
    async start(): Promise<INestApplication> {
      await turn.take();
      await unlessStopped();
      await store.start();
      storeStarted = true;
      await unlessStopped();
      const config = readEnv(
        ['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV],
        { ...env, ...store.env() },
      );
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.register(config)],
      }).compile();
      app = moduleRef.createNestApplication({ bufferLogs: true });
      await unlessStopped();
      configureApp(app, config);
      await app.init();
      await unlessStopped();
      return app;
    },

    stop(): Promise<void> {
      stopped = true;
      return giveBack();
    },
  };
}
