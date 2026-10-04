import type { Env, StorageEnv } from '@motor-fix/contracts';
import {
  AuthModule,
  EventsModule,
  HealthModule,
  StorageModule,
} from '@motor-fix/domain';
import { DynamicModule, Module } from '@nestjs/common';

type ApiEnv = Env<'DATABASE_URL' | 'REDIS_URL' | 'AUTH_TOKEN_SECRET'> &
  StorageEnv;

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      imports: [
        HealthModule.register({
          databaseUrl: env.DATABASE_URL,
          redisUrl: env.REDIS_URL,
          version: env.RELEASE_SHA,
        }),
        StorageModule.register(env),
        AuthModule.register({
          databaseUrl: env.DATABASE_URL,
          redisUrl: env.REDIS_URL,
          tokenSecret: env.AUTH_TOKEN_SECRET,
        }),
        EventsModule.register({ redisUrl: env.REDIS_URL }),
      ],
      module: AppModule,
    };
  }
}
