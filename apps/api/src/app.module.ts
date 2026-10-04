import type { Env } from '@motor-fix/contracts';
import { AuthModule, HealthModule } from '@motor-fix/domain';
import { DynamicModule, Module } from '@nestjs/common';

type ApiEnv = Env<'DATABASE_URL' | 'REDIS_URL' | 'AUTH_TOKEN_SECRET'>;

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
        AuthModule.register({
          databaseUrl: env.DATABASE_URL,
          tokenSecret: env.AUTH_TOKEN_SECRET,
        }),
      ],
      module: AppModule,
    };
  }
}
