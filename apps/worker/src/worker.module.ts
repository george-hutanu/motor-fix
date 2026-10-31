import { bunnyConfig, type Env, STORAGE_ENV } from '@motor-fix/contracts';
import {
  ACCOUNT_CLOSED_CONSUMER,
  AccountClosedModule,
  APPROVAL_TIMERS_CONSUMER,
  ApprovalTimersModule,
  BOOKING_CANCELLED_CONSUMER,
  BOOKING_CONFIRMED_CONSUMER,
  BOOKING_LAPSED_CONSUMER,
  BOOKING_TIMERS_CONSUMER,
  BookingTimersModule,
  CAR_ACCOUNT_DELETED_CONSUMER,
  CAR_REMINDERS_CONSUMER,
  CAR_TRANSFER_ACCEPTED_CONSUMER,
  CATALOGUE_JOB_DECIDED_CONSUMER,
  CATALOGUE_JOB_PENDING_CONSUMER,
  CarAccountDeletedModule,
  DATA_EXPORT_CONSUMER,
  DataExportModule,
  DataStoreMetricsModule,
  DECLINE_WINDOW_CONSUMER,
  DeclineWindowModule,
  DOCUMENT_REFUSED_CONSUMER,
  dailyTasks,
  emailConfig,
  FINAL_PRICE_CORRECTED_CONSUMER,
  GARAGE_REPORT_DECIDED_CONSUMER,
  GARAGE_RESTORED_CONSUMER,
  GARAGE_SUSPENDED_CONSUMER,
  HealthModule,
  InsightsModule,
  JOB_STAGE_CONSUMER,
  LIVE_INPUTS_CONSUMER,
  LIVE_RECORDINGS_CONSUMER,
  ListingPhotosWorkerModule,
  LiveIdleModule,
  LiveInputsModule,
  LiveRecordingsModule,
  liveVideoConfig,
  MediaProcessingModule,
  MediaRetentionModule,
  MODERATION_TIMERS_CONSUMER,
  ModerationTimersModule,
  NEWS_CONSUMER,
  NotificationsModule,
  OutboxRelayModule,
  phoneConfig,
  placesConfig,
  pushConfig,
  QUOTE_ACCEPTED_CONSUMER,
  QUOTE_DECLINED_CONSUMER,
  QUOTE_LOST_CONSUMER,
  QUOTE_RECEIVED_CONSUMER,
  REPAIR_UPDATED_CONSUMER,
  REQUEST_CANCELLED_CONSUMER,
  REQUEST_RECEIVED_CONSUMER,
  REQUEST_TIMERS_CONSUMER,
  REVIEW_POSTED_CONSUMER,
  REVIEW_RATINGS_CONSUMER,
  REVIEW_REPLIED_CONSUMER,
  RemindersModule,
  RequestTimersModule,
  RetentionModule,
  ReviewRatingsModule,
  reminderDayMs,
  StatusModule,
  StorageModule,
  SupportModule,
  SystemLogModule,
  supportConfig,
  supportMessagesConsumer,
  VERIFICATION_RESULT_CONSUMER,
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
// WhatsApp, sends the contact form's e-mails, runs the monthly news, the daily reminders, the decline windows, the booking timers, the assistant approvals' expiry,
// the listing draft sweep, the listing photos' copies, the live sessions'
// idle stop and their recordings' deletes, and the nightly
// platform figures (placing the garages with no city first), checks the
// services behind the admin dashboard's tiles and reads the data stores for
// their figures.
export function workerModule(
  env: Env<(typeof WORKER_ENV)[number]>,
): DynamicModule {
  const email = emailConfig(env.APP_ENV, process.env);
  const support = supportConfig(process.env);
  const liveVideo = liveVideoConfig(env.APP_ENV, process.env);
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
        cdn: bunnyConfig(process.env),
        consumers: [
          ACCOUNT_CLOSED_CONSUMER,
          APPROVAL_TIMERS_CONSUMER,
          BOOKING_CANCELLED_CONSUMER,
          BOOKING_CONFIRMED_CONSUMER,
          JOB_STAGE_CONSUMER,
          BOOKING_LAPSED_CONSUMER,
          BOOKING_TIMERS_CONSUMER,
          CAR_ACCOUNT_DELETED_CONSUMER,
          DATA_EXPORT_CONSUMER,
          CAR_REMINDERS_CONSUMER,
          CATALOGUE_JOB_DECIDED_CONSUMER,
          FINAL_PRICE_CORRECTED_CONSUMER,
          CATALOGUE_JOB_PENDING_CONSUMER,
          DECLINE_WINDOW_CONSUMER,
          DOCUMENT_REFUSED_CONSUMER,
          GARAGE_REPORT_DECIDED_CONSUMER,
          GARAGE_RESTORED_CONSUMER,
          GARAGE_SUSPENDED_CONSUMER,
          LIVE_INPUTS_CONSUMER,
          LIVE_RECORDINGS_CONSUMER,
          MODERATION_TIMERS_CONSUMER,
          NEWS_CONSUMER,
          QUOTE_RECEIVED_CONSUMER,
          QUOTE_ACCEPTED_CONSUMER,
          QUOTE_DECLINED_CONSUMER,
          QUOTE_LOST_CONSUMER,
          REQUEST_CANCELLED_CONSUMER,
          REQUEST_RECEIVED_CONSUMER,
          REQUEST_TIMERS_CONSUMER,
          REVIEW_POSTED_CONSUMER,
          REVIEW_REPLIED_CONSUMER,
          REVIEW_RATINGS_CONSUMER,
          CAR_TRANSFER_ACCEPTED_CONSUMER,
          REPAIR_UPDATED_CONSUMER,
          supportMessagesConsumer(support),
          VERIFICATION_RESULT_CONSUMER,
        ],
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
      }),
      notifications,
      RemindersModule.registerWorker({
        daily: dailyTasks(email.webUrl),
        dayMs: reminderDayMs(env.APP_ENV, process.env),
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // Closes a deleted or suspended driver's requests and bookings.
      AccountClosedModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
      }),
      // Builds a requested copy of a person's data, e-mails its link and
      // expires the files.
      DataExportModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // Clears a deleted account's plates.
      CarAccountDeletedModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
      }),
      // Writes a garage's and a mechanic's rating from their published reviews.
      ReviewRatingsModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
      }),
      // Reminds the garage to confirm an accepted booking, and lapses it.
      BookingTimersModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // Reminds the garages a request still waits on, and expires requests
      // and quotes at the end of their seven days.
      RequestTimersModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // Tells the admins of a reported review, reminds them after 48 hours,
      // and closes a report whose review its author deleted.
      ModerationTimersModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // Tells the driver of a decline once its undo window has passed.
      DeclineWindowModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // Tells the account its assistant waits for an approval, and expires
      // the approval nobody decided in 30 minutes.
      ApprovalTimersModule.registerWorker({
        notifications,
        redisUrl: env.REDIS_URL,
        webUrl: email.webUrl,
      }),
      // The contact form's e-mails: to the support mailbox and the sender.
      SupportModule.registerWorker({
        email,
        notifications,
        redisUrl: env.REDIS_URL,
        support,
      }),
      ListingPhotosWorkerModule.register({ redisUrl: env.REDIS_URL }),
      // Converts the job photos, clips and kept recordings.
      MediaProcessingModule.register({
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
      }),
      InsightsModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        // Places the garages with no city before the night's figures.
        places: placesConfig(env.APP_ENV, process.env),
        redisUrl: env.REDIS_URL,
      }),
      // The admin dashboard's six service tiles, checked every 30 seconds.
      SystemLogModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
        version: env.RELEASE_SHA,
      }),
      // Nightly: removes and anonymises what is past the stated retention periods.
      RetentionModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
      }),
      // Nightly: deletes the job media past its purge date.
      MediaRetentionModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        liveVideo,
        redisUrl: env.REDIS_URL,
      }),
      // Every minute: stops the live sessions with no publisher for ten
      // minutes.
      LiveIdleModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        liveVideo,
        redisUrl: env.REDIS_URL,
      }),
      // After each live stop: closes the session's input at the provider.
      LiveInputsModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        liveVideo,
        redisUrl: env.REDIS_URL,
      }),
      // After each live stop: counts a kept recording, deletes a discarded
      // one at the provider.
      LiveRecordingsModule.registerWorker({
        databaseUrl: env.DATABASE_URL,
        liveVideo,
        redisUrl: env.REDIS_URL,
      }),
      StatusModule.registerWorker({
        appEnv: env.APP_ENV,
        backupEnv: process.env,
        brevo: { apiKey: email.apiKey, apiUrl: email.apiUrl },
        databaseUrl: env.DATABASE_URL,
        places: placesConfig(env.APP_ENV, process.env),
        redisUrl: env.REDIS_URL,
        thresholds: process.env['STATUS_THRESHOLDS'],
        webUrl: email.webUrl,
      }),
      DataStoreMetricsModule.register({
        databaseUrl: env.DATABASE_URL,
        keycloakMetricsUrl: process.env['KEYCLOAK_METRICS_URL'],
        monitorUrl: process.env['MONITOR_DATABASE_URL'],
        redisUrl: env.REDIS_URL,
      }),
    ],
    module: WorkerModule,
  };
}
