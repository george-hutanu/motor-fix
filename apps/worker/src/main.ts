import './telemetry';

import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import {
  emailConfig,
  HealthModule,
  InsightsModule,
  JsonLogger,
  listingDraftDaily,
  NEWS_CONSUMER,
  NotificationsModule,
  OutboxRelayModule,
  phoneConfig,
  pushConfig,
  RemindersModule,
  reminderDayMs,
  StorageModule,
} from '@motor-fix/domain';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';

// The worker serves no routes of its own: its HTTP listener exists so that
// Railway can health-check it. It relays the outbox's events to the live
// streams, consumes the notifications queue, sending e-mail, SMS and
// WhatsApp, runs the monthly news, the daily reminders, the listing draft
// sweep and the nightly platform figures.
async function bootstrap() {
  const env = readEnv(['DATABASE_URL', 'REDIS_URL', ...STORAGE_ENV]);
  const email = emailConfig(env.APP_ENV, process.env);
  const notifications = NotificationsModule.registerWorker({
    databaseUrl: env.DATABASE_URL,
    email,
    phone: phoneConfig(env.APP_ENV, process.env),
    push: pushConfig(process.env),
    redisUrl: env.REDIS_URL,
    // Signs the news e-mails' unsubscribe links, as the API checks them.
    tokenSecret: process.env['AUTH_TOKEN_SECRET'],
  });

  @Module({
    imports: [
      HealthModule.register({
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
        version: env.RELEASE_SHA,
      }),
      StorageModule.register(env),
      OutboxRelayModule.register({
        consumers: [NEWS_CONSUMER],
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
      }),
      notifications,
      RemindersModule.registerWorker({
        daily: listingDraftDaily(email.webUrl),
        dayMs: reminderDayMs(env.APP_ENV, process.env),
        notifications,
        redisUrl: env.REDIS_URL,
      }),
      InsightsModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
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
