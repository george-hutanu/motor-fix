export {
  type Capability,
  capabilitiesOf,
  ROLES,
  type Role,
} from '@motor-fix/contracts/capabilities';

export { AdminAccountModule } from './admin/admin-accounts/account/account.module';
export { AdminAccountsModule } from './admin/admin-accounts/admin-accounts.module';
export { PlatformRulesModule } from './admin/platform-rules/platform-rules.module';
export { systemLog } from './admin/system-log/system-log';
export { SystemLogModule } from './admin/system-log/system-log.module';
export { AUDIT_PORT, type AuditPort } from './audit/audit.port';
export { AuditService } from './audit/audit.service';
export {
  consentPending,
  pendingAcceptance,
} from './auth/acceptance/acceptance';
export { signAccessToken } from './auth/access-token';
export {
  AccountLoader,
  actorOf,
  type LoadedAccount,
} from './auth/account-loader';
export { AccountsService } from './auth/accounts.service';
export {
  ActorGuard,
  CurrentActor,
  OpenInMaintenance,
  Public,
  Requires,
} from './auth/actor.guard';
export { assistantBroker } from './auth/assistant/assistant.service';
export { APPROVAL_TIMERS_CONSUMER } from './auth/assistant-approvals/approval-timers/approval-timers';
export { ApprovalTimersModule } from './auth/assistant-approvals/approval-timers/approval-timers.module';
export {
  AssistantApprovals,
  type Decider as ApprovalDecider,
  type LockedApproval,
} from './auth/assistant-approvals/assistant-approvals';
export {
  type ApprovalKind,
  type ApprovalOutcome,
  ApproveAssistantActionDto,
  AssistantActionApprovalDto,
  AssistantActionApprovalListDto,
} from './auth/assistant-approvals/assistant-approvals.dto';
export {
  AssistantConfirmations,
  type Decision as ConfirmationDecision,
  judge as judgeConfirmation,
  type Tx,
  voidAssistantConfirmations,
} from './auth/assistant-confirmations/assistant-confirmations';
export { AuthModule } from './auth/auth.module';
export { DashboardLayoutsModule } from './auth/dashboard-layouts/dashboard-layouts.module';
export { DATA_EXPORT_CONSUMER } from './auth/data-export/data-export.builder';
export { DataExportModule } from './auth/data-export/data-export.module';
export { EmailConfirmationModule } from './auth/email-confirmation/email-confirmation.module';
export {
  MAINTENANCE,
  type Maintenance,
  type MaintenanceReader,
  maintenanceRefusal,
  storedMaintenance,
} from './auth/maintenance';
export { oauthSettings } from './auth/oauth/providers';
export { PasswordResetModule } from './auth/password/password-reset/password-reset.module';
export { PhoneSignInModule } from './auth/phone-sign-in/phone-sign-in.module';
export { type Actor, assertGarage, assertOwner } from './auth/policy';
export { createPrisma, PRISMA } from './auth/prisma';
export { signInLimitConfig } from './auth/qa-sign-in-limit';
export { local as bucharestTime } from './bucharest';
export { WarmModule } from './cache/warm/warm.module';
export { warmCache } from './cache/warm-up/warm-up';
export { CAR_ACCOUNT_DELETED_CONSUMER } from './cars/account-deleted/account-deleted';
export { CarAccountDeletedModule } from './cars/account-deleted/account-deleted.module';
export { ClientRepairsModule } from './cars/client-repairs/client-repairs.module';
export { CarHistoryModule } from './cars/history/history.module';
export { CarsModule } from './cars/my-cars/cars/cars.module';
export {
  CAR_REMINDERS_CONSUMER,
  RemindersModule,
} from './cars/reminders/reminders.module';
export { reminderDayMs } from './cars/reminders/reminders-config';
export { REPAIR_FROM_JOB_CONSUMER } from './cars/repair-from-job/repair-from-job';
export { RepairFromJobModule } from './cars/repair-from-job/repair-from-job.module';
export { RepairsModule } from './cars/repairs/repairs.module';
export { SavedGaragesModule } from './cars/saved-garages/saved-garages.module';
export { CarTransfersModule } from './cars/transfers/transfers.module';
export { BrandLoader } from './catalogue/brand-loader';
export {
  type BodyStyle,
  BRANDS,
} from './catalogue/brands/brands';
export { type CarForBrand, carForBrand } from './catalogue/car-models';
export { CatalogueModule } from './catalogue/catalogue.module';
export { JobTypeLoader } from './catalogue/job-types/job-type-loader';
export { JOB_TYPES } from './catalogue/job-types/job-types';
export { CAR_MODELS } from './catalogue/models-3d/models-3d';
export { Models3dLoader } from './catalogue/models-3d/models-3d.loader';
export { EVENT_PORT, type EventPort, outbox } from './events/event.port';
export { EventsModule } from './events/events.module';
export { OutboxRelayModule } from './events/outbox-relay/outbox-relay.module';
export { observabilityUrl } from './garages/admin-overview.controller';
export { GarageDetailsService } from './garages/details/garage-details.service';
export { ListingDocumentsModule } from './garages/documents/listing-documents/listing-documents.module';
export { OwnerDocumentsModule } from './garages/documents/owner-documents/owner-documents.module';
export { featureOn } from './garages/features/feature-on';
export { writeGarageBrands } from './garages/garage-brands/write-garage-brands';
export { writeGarageHours } from './garages/garage-hours';
export { writeGaragePayments } from './garages/garage-settings/write-garage-payments';
export { GaragesModule } from './garages/garages.module';
export { ListingSubmitModule } from './garages/listing-drafts/submit/submit.module';
export { GarageMechanicsService } from './garages/mechanics/garage-mechanics.service';
export { GaragePhotosService } from './garages/photos/garage-photos.service';
export { ListingPhotosModule } from './garages/photos/listing-photos/listing-photos.module';
export { ListingPhotosWorkerModule } from './garages/photos/listing-photos/listing-photos.worker';
export { GaragePlaceService } from './garages/place/garage-place.service';
export { GaragePricesService } from './garages/prices/garage-prices/garage-prices.service';
export { applySurvey } from './garages/survey/survey';
export {
  type Decision,
  type VerificationActor,
  VerificationService,
} from './garages/verification/verification.service';
export { verificationConfig } from './garages/verification/verification-config';
export * from './health/health.module';
export { AREAS, AreaLoader } from './insights/areas/areas';
export { DemandModule } from './insights/demand/demand.module';
export { GarageFiguresModule } from './insights/garage-figures/garage-figures.module';
export { GarageFiguresService } from './insights/garage-figures/garage-figures.service';
export { InsightsModule } from './insights/insights.module';
export { ProfileViewsModule } from './insights/profile-views/profile-views.module';
export { LiveIdleModule } from './live-video/idle/idle.module';
export { LIVE_INPUTS_CONSUMER } from './live-video/inputs/inputs';
export { LiveInputsModule } from './live-video/inputs/inputs.module';
export {
  LiveVideoModule,
  liveVideoConfig,
} from './live-video/live-video.module';
export { LIVE_RECORDINGS_CONSUMER } from './live-video/recordings/recordings';
export { LiveRecordingsModule } from './live-video/recordings/recordings.module';
export * from './logging';
export { MapsModule } from './maps/maps.module';
export { MediaModule } from './media/media.module';
export { MediaService } from './media/media.service';
export { MediaProcessingModule } from './media/processing/processing.module';
export { MediaRetentionModule } from './media/retention/retention.module';
export { DataStoreMetricsModule } from './metrics/data-store-metrics.module';
export {
  countConsentRefusal,
  initProductCounters,
} from './metrics/product-counters';
export { BOOKING_CANCELLED_CONSUMER } from './notifications/booking-cancelled/booking-cancelled.fan-out';
export { BOOKING_CONFIRMED_CONSUMER } from './notifications/booking-confirmed/booking-confirmed.fan-out';
export { BOOKING_LAPSED_CONSUMER } from './notifications/booking-lapsed/booking-lapsed.fan-out';
export { Brevo } from './notifications/brevo/brevo';
export { CAR_TRANSFER_ACCEPTED_CONSUMER } from './notifications/car-transfer-accepted/car-transfer-accepted.fan-out';
export { CATALOGUE_JOB_DECIDED_CONSUMER } from './notifications/catalogue-job-decided/catalogue-job-decided.fan-out';
export { CATALOGUE_JOB_PENDING_CONSUMER } from './notifications/catalogue-job-pending/catalogue-job-pending.fan-out';
export { DirectSendModule } from './notifications/direct-send/direct-send.module';
export { DOCUMENT_REFUSED_CONSUMER } from './notifications/document-refused/document-refused.fan-out';
export { emailConfig, sendingDomain } from './notifications/email-config';
export {
  checkEmailDns,
  type DnsResolver,
  dnsReport,
} from './notifications/email-dns/email-dns';
export { FINAL_PRICE_CORRECTED_CONSUMER } from './notifications/final-price-corrected/final-price-corrected.fan-out';
export { GARAGE_REPORT_DECIDED_CONSUMER } from './notifications/garage-report-decided/garage-report-decided.fan-out';
export { GARAGE_RESTORED_CONSUMER } from './notifications/garage-restored/garage-restored.fan-out';
export { GARAGE_SUSPENDED_CONSUMER } from './notifications/garage-suspended/garage-suspended.fan-out';
export {
  inboxMailboxes,
  runInboxTest,
} from './notifications/inbox-test/inbox-test';
export { JOB_STAGE_CONSUMER } from './notifications/job-stage/job-stage.fan-out';
export { NEWS_CONSUMER } from './notifications/news/news.fan-out';
export { NO_SHOW_CONSUMER } from './notifications/no-show/no-show.fan-out';
export { NotificationsModule } from './notifications/notifications.module';
export { NotificationsService } from './notifications/notifications.service';
export { phoneConfig } from './notifications/phone-config';
export { pushConfig } from './notifications/push/push-config';
export { QUOTE_ACCEPTED_CONSUMER } from './notifications/quote-accepted/quote-accepted.fan-out';
export { QUOTE_DECLINED_CONSUMER } from './notifications/quote-declined/quote-declined.fan-out';
export { QUOTE_LOST_CONSUMER } from './notifications/quote-lost/quote-lost.fan-out';
export { QUOTE_RECEIVED_CONSUMER } from './notifications/quote-received/quote-received.fan-out';
export { REPAIR_UPDATED_CONSUMER } from './notifications/repair-updated/repair-updated.fan-out';
export { REQUEST_CANCELLED_CONSUMER } from './notifications/request-cancelled/request-cancelled.fan-out';
export { REQUEST_RECEIVED_CONSUMER } from './notifications/request-received/request-received.fan-out';
export { REVIEW_POSTED_CONSUMER } from './notifications/review-posted/review-posted.fan-out';
export { REVIEW_REPLIED_CONSUMER } from './notifications/review-replied/review-replied.fan-out';
export { VERIFICATION_RESULT_CONSUMER } from './notifications/verification-result/verification-result.fan-out';
export { PlacesModule, placesConfig } from './places/places.module';
export { ACCOUNT_CLOSED_CONSUMER } from './quotes/account-closed/account-closed';
export { AccountClosedModule } from './quotes/account-closed/account-closed.module';
export { BOOKING_TIMERS_CONSUMER } from './quotes/booking-timers/booking-timers';
export { BookingTimersModule } from './quotes/booking-timers/booking-timers.module';
export {
  type DeclinePreview,
  DeclineService,
} from './quotes/decline/decline.service';
export { DECLINE_WINDOW_CONSUMER } from './quotes/decline-window/decline-window';
export { DeclineWindowModule } from './quotes/decline-window/decline-window.module';
export { GarageRequestsService } from './quotes/garage-requests/garage-requests.service';
export { GarageScheduleService } from './quotes/garage-schedule/garage-schedule.service';
export { QuotesModule } from './quotes/quotes.module';
export { REQUEST_TIMERS_CONSUMER } from './quotes/request-timers/request-timers';
export { RequestTimersModule } from './quotes/request-timers/request-timers.module';
export { ROUTE_LIMITS } from './rate-limit/rate-limit.config';
export { countRateLimitRefusal } from './rate-limit/rate-limit.metrics';
export { RateLimits } from './rate-limit/rate-limit.service';
export { RetentionModule } from './retention/retention.module';
export { MODERATION_TIMERS_CONSUMER } from './reviews/moderation-timers/moderation-timers';
export { ModerationTimersModule } from './reviews/moderation-timers/moderation-timers.module';
export { REVIEW_RATINGS_CONSUMER } from './reviews/ratings/ratings';
export { ReviewRatingsModule } from './reviews/ratings/ratings.module';
export { ReviewsModule } from './reviews/reviews.module';
export { dailyTasks } from './scheduler/tasks';
export { SearchModule } from './search/search.module';
export { StatusModule } from './status/status.module';
export * from './storage/storage.module';
export { StorageService } from './storage/storage.service';
export { borrowStore, returnStore } from './store/store';
export { supportMessagesConsumer } from './support/delivery/delivery.consumer';
export { SupportModule } from './support/support.module';
export { type SupportConfig, supportConfig } from './support/support-config';
export { DaySheetService } from './workshop/day-sheet/day-sheet.service';
export { WorkshopModule } from './workshop/workshop.module';
