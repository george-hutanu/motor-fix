import type { Env, StorageEnv } from '@motor-fix/contracts';
import {
  AuthModule,
  EmailConfirmationModule,
  EventsModule,
  emailConfig,
  GaragesModule,
  HealthModule,
  NotificationsModule,
  oauthSettings,
  PasswordResetModule,
  PhoneSignInModule,
  phoneConfig,
  pushConfig,
  StorageModule,
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
        GaragesModule.register(email, notifications),
        EventsModule.register({ redisUrl: env.REDIS_URL }),
      ],
      module: AppModule,
    };
  }
}
