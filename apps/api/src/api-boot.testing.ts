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

  return {
    async start(): Promise<INestApplication> {
      await turn.take();
      await store.start();
      storeStarted = true;
      const config = readEnv(
        ['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV],
        { ...env, ...store.env() },
      );
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.register(config)],
      }).compile();
      app = moduleRef.createNestApplication({ bufferLogs: true });
      configureApp(app, config);
      await app.init();
      return app;
    },

    async stop(): Promise<void> {
      const closes: (() => Promise<unknown>)[] = [];
      if (app) closes.push(app.close.bind(app));
      if (storeStarted) closes.push(() => store.stop());
      app = undefined;
      storeStarted = false;
      const failures: unknown[] = [];
      for (const close of closes) {
        await close().catch((error: unknown) => failures.push(error));
      }
      await turn.release();
      if (failures.length > 0) throw failures[0];
    },
  };
}
