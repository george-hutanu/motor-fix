import type { Env, StorageEnv } from '@motor-fix/contracts';
import {
  AuthModule,
  CarsModule,
  CatalogueModule,
  EmailConfirmationModule,
  EventsModule,
  emailConfig,
  GaragesModule,
  HealthModule,
  ListingPhotosModule,
  NotificationsModule,
  oauthSettings,
  PasswordResetModule,
  PhoneSignInModule,
  PlacesModule,
  PlatformRulesModule,
  phoneConfig,
  placesConfig,
  pushConfig,
  SearchModule,
  StorageModule,
  verificationConfig,
} from '@motor-fix/domain';
import { DynamicModule, Module } from '@nestjs/common';

type ApiEnv = Env<'DATABASE_URL' | 'REDIS_URL' | 'AUTH_TOKEN_SECRET'> &
  StorageEnv;

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    const auth = AuthModule.register({
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
        push: pushConfig(process.env),
        redisUrl: env.REDIS_URL,
      },
      auth,
    );
    const garages = GaragesModule.register(
      email,
      notifications,
      verificationConfig(env.APP_ENV, process.env),
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
        CarsModule,
        CatalogueModule,
        SearchModule,
        PlacesModule.register(placesConfig(env.APP_ENV, process.env)),
        garages,
        ListingPhotosModule.register({ redisUrl: env.REDIS_URL }, garages),
        EventsModule.register({ redisUrl: env.REDIS_URL }),
        PlatformRulesModule.register({
          production: env.APP_ENV === 'production',
        }),
      ],
      module: AppModule,
    };
  }
}
