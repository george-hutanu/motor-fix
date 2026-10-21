import {
  type Env,
  grafanaUrl,
  outageWebhookToken,
  type StorageEnv,
} from '@motor-fix/contracts';
import {
  AdminAccountsModule,
  AuthModule,
  assistantBroker,
  CarsModule,
  CatalogueModule,
  DemandModule,
  EmailConfirmationModule,
  EventsModule,
  emailConfig,
  GaragesModule,
  HealthModule,
  ListingDocumentsModule,
  ListingPhotosModule,
  ListingSubmitModule,
  NotificationsModule,
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
  SavedGaragesModule,
  SearchModule,
  StorageModule,
  SupportModule,
  SystemLogModule,
  supportConfig,
  verificationConfig,
  WarmModule,
  WorkshopModule,
} from '@motor-fix/domain';
import { DynamicModule, Module } from '@nestjs/common';

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
      tokenSecret: env.AUTH_TOKEN_SECRET,
    });
    const email = emailConfig(env.APP_ENV, process.env);
    const notifications = NotificationsModule.register(
      {
        databaseUrl: env.DATABASE_URL,
        email,
        outageWebhookToken: outageWebhookToken(process.env),
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
        PhoneSignInModule.register({
          brevo: { apiKey: email.apiKey ?? '', apiUrl: email.apiUrl },
          phone: phoneConfig(env.APP_ENV, process.env),
        }),
        AdminAccountsModule,
        CarsModule,
        SavedGaragesModule,
        CatalogueModule,
        SearchModule,
        QuotesModule,
        WarmModule,
        WorkshopModule,
        PlacesModule.register(placesConfig(env.APP_ENV, process.env)),
        ProfileViewsModule,
        SupportModule.register(supportConfig(process.env)),
        DemandModule,
        garages,
        photos,
        ListingDocumentsModule.register(garages),
        ListingSubmitModule.register(garages, photos),
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
