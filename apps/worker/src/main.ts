import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import {
  emailConfig,
  HealthModule,
  JsonLogger,
  NotificationsModule,
  phoneConfig,
  StorageModule,
} from '@motor-fix/domain';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';

// The worker serves no routes of its own: its HTTP listener exists so that
// Railway can health-check it. It consumes the notifications queue, sending
// e-mail, SMS and WhatsApp.
async function bootstrap() {
  const env = readEnv(['DATABASE_URL', 'REDIS_URL', ...STORAGE_ENV]);

  @Module({
    imports: [
      HealthModule.register({
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
        version: env.RELEASE_SHA,
      }),
      StorageModule.register(env),
      NotificationsModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        email: emailConfig(env.APP_ENV, process.env),
        phone: phoneConfig(env.APP_ENV, process.env),
        redisUrl: env.REDIS_URL,
      }),
    ],
  })
  class WorkerModule {}

  const app = await NestFactory.create(WorkerModule, new ExpressAdapter(), {
    logger: new JsonLogger(),
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env['PORT'] ?? 3001));
}

void bootstrap();
