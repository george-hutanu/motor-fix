import {
  type Env,
  grafanaUrl,
  mapTilesTileJsonUrl,
  outageWebhookToken,
  type StorageEnv,
} from '@motor-fix/contracts';
import {
  AdminAccountModule,
  AdminAccountsModule,
  AuthModule,
  assistantBroker,
  CarsModule,
  CarTransfersModule,
  CatalogueModule,
  DashboardLayoutsModule,
  DataExportModule,
  DemandModule,
  EmailConfirmationModule,
  EventsModule,
  emailConfig,
  GaragesModule,
  HealthModule,
  ListingDocumentsModule,
  ListingPhotosModule,
  ListingSubmitModule,
  LiveVideoModule,
  liveVideoConfig,
  MapsModule,
  MediaModule,
  NotificationsModule,
  OwnerDocumentsModule,
  oauthSettings,
  observabilityUrl,
  PasswordResetModule,
  PhoneSignInModule,
  PlacesModule,
  PlatformRulesModule,
  ProfileViewsModule,
  phoneConfig,
  placesConfig,
  pushConfig,
  QuotesModule,
  ReviewsModule,
  SavedGaragesModule,
  SearchModule,
  StorageModule,
  SupportModule,
  SystemLogModule,
  signInLimitConfig,
  supportConfig,
  verificationConfig,
  WarmModule,
  WorkshopModule,
} from '@motor-fix/domain';
import { DynamicModule, Logger, Module } from '@nestjs/common';

type ApiEnv = Env<'DATABASE_URL' | 'REDIS_URL' | 'AUTH_TOKEN_SECRET'> &
  StorageEnv;

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    const auth = AuthModule.register({
      assistant: assistantBroker(process.env),
      databaseUrl: env.DATABASE_URL,
      oauth: oauthSettings(env.APP_ENV, process.env),
      redisUrl: env.REDIS_URL,
      skipSignInAttemptsLimit: signInLimitConfig(
        env.APP_ENV,
        process.env,
        (m) => new Logger('AuthModule').warn(m),
      ),
      tokenSecret: env.AUTH_TOKEN_SECRET,
    });
    const email = emailConfig(env.APP_ENV, process.env);
    const phone = phoneConfig(env.APP_ENV, process.env);
    const notifications = NotificationsModule.register(
      {
        databaseUrl: env.DATABASE_URL,
        email,
        outageWebhookToken: outageWebhookToken(process.env),
        phone,
        push: pushConfig(process.env),
        redisUrl: env.REDIS_URL,
      },
      auth,
    );
    const garages = GaragesModule.register(
      email,
      notifications,
      verificationConfig(env.APP_ENV, process.env),
      observabilityUrl(grafanaUrl(process.env), env.APP_ENV),
    );
    const liveVideo = liveVideoConfig(env.APP_ENV, process.env);
    const live = LiveVideoModule.register(liveVideo);
    const photos = ListingPhotosModule.register(
      { redisUrl: env.REDIS_URL },
      garages,
    );
    return {
      imports: [
        HealthModule.register({
          databaseUrl: env.DATABASE_URL,
          redisUrl: env.REDIS_URL,
          version: env.RELEASE_SHA,
        }),
        StorageModule.register(env),
        auth,
        notifications,
        EmailConfirmationModule.register(
          { webUrl: email.webUrl },
          notifications,
        ),
        PasswordResetModule.register({ webUrl: email.webUrl }, notifications),
        DataExportModule.register(),
        PhoneSignInModule.register({
          brevo: { apiKey: email.apiKey ?? '', apiUrl: email.apiUrl },
          phone,
        }),
        CarTransfersModule.register({
          brevo: { apiKey: email.apiKey ?? '', apiUrl: email.apiUrl },
          phone,
          webUrl: email.webUrl,
        }),
        AdminAccountsModule,
        AdminAccountModule.register(
          { support: email.replyTo?.email, webUrl: email.webUrl },
          notifications,
        ),
        CarsModule,
        SavedGaragesModule,
        DashboardLayoutsModule,
        CatalogueModule,
        SearchModule,
        QuotesModule,
        ReviewsModule,
        WarmModule,
        WorkshopModule,
        PlacesModule.register(placesConfig(env.APP_ENV, process.env)),
        live,
        MediaModule.register({ live, redisUrl: env.REDIS_URL }),
        MapsModule.register({ tileJsonUrl: mapTilesTileJsonUrl(process.env) }),
        ProfileViewsModule,
        SupportModule.register(supportConfig(process.env)),
        DemandModule,
        garages,
        photos,
        ListingDocumentsModule.register(garages),
        OwnerDocumentsModule.register(garages, notifications, email.webUrl),
        ListingSubmitModule.register(garages, photos, notifications),
        EventsModule.register({ redisUrl: env.REDIS_URL }),
        SystemLogModule.register({
          databaseUrl: env.DATABASE_URL,
          redisUrl: env.REDIS_URL,
        }),
        PlatformRulesModule.register(
          { production: env.APP_ENV === 'production', webUrl: email.webUrl },
          notifications,
        ),
      ],
      module: AppModule,
    };
  }
}
