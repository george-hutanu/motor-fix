import { type Env, STORAGE_ENV } from '@motor-fix/contracts';
import {
  DataStoreMetricsModule,
  DECLINE_WINDOW_CONSUMER,
  DeclineWindowModule,
  emailConfig,
  HealthModule,
  InsightsModule,
  ListingPhotosWorkerModule,
  listingDraftDaily,
  NEWS_CONSUMER,
  NotificationsModule,
  OutboxRelayModule,
  phoneConfig,
  placesConfig,
  pushConfig,
  QUOTE_RECEIVED_CONSUMER,
  REQUEST_RECEIVED_CONSUMER,
  RemindersModule,
  reminderDayMs,
  StorageModule,
} from '@motor-fix/domain';
import { type DynamicModule, Module } from '@nestjs/common';

export const WORKER_ENV = [
  'DATABASE_URL',
  'REDIS_URL',
  ...STORAGE_ENV,
] as const;

@Module({})
class WorkerModule {}

// The worker serves no routes of its own: its HTTP listener exists so that
// Railway can health-check it. It relays the outbox's events to the live
// streams, consumes the notifications queue, sending e-mail, SMS and
// WhatsApp, runs the monthly news, the daily reminders, the decline windows,
// the listing draft sweep, the listing photos' copies and the nightly
// platform figures (placing the garages with no city first), and reads the
// data stores for their figures.
export function workerModule(
  env: Env<(typeof WORKER_ENV)[number]>,
): DynamicModule {
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
  return {
    imports: [
      HealthModule.register({
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
        version: env.RELEASE_SHA,
      }),
      StorageModule.register(env),
      OutboxRelayModule.register({
        consumers: [
          DECLINE_WINDOW_CONSUMER,
          NEWS_CONSUMER,
          QUOTE_RECEIVED_CONSUMER,
          REQUEST_RECEIVED_CONSUMER,
        ],
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
      // Tells the driver of a decline once its undo window has passed.
      DeclineWindowModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      ListingPhotosWorkerModule.register({ redisUrl: env.REDIS_URL }),
      InsightsModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        // Places the garages with no city before the night's figures.
        places: placesConfig(env.APP_ENV, process.env),
        redisUrl: env.REDIS_URL,
      }),
      DataStoreMetricsModule.register({
        databaseUrl: env.DATABASE_URL,
        monitorUrl: process.env['MONITOR_DATABASE_URL'],
        redisUrl: env.REDIS_URL,
      }),
    ],
    module: WorkerModule,
  };
}
