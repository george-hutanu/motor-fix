import type { Env, StorageEnv } from '@motor-fix/contracts';
import {
  AuthModule,
  EmailConfirmationModule,
  EventsModule,
  emailConfig,
  HealthModule,
  NotificationsModule,
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
      redisUrl: env.REDIS_URL,
      tokenSecret: env.AUTH_TOKEN_SECRET,
    });
    const email = emailConfig(env.APP_ENV, process.env);
    const notifications = NotificationsModule.register(
      { databaseUrl: env.DATABASE_URL, email, redisUrl: env.REDIS_URL },
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
        EventsModule.register({ redisUrl: env.REDIS_URL }),
      ],
      module: AppModule,
    };
  }
}
