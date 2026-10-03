import type { Env } from '@motor-fix/contracts';
import { HealthModule } from '@motor-fix/domain';
import { DynamicModule, Module } from '@nestjs/common';

export type ApiEnv = Env<'DATABASE_URL' | 'REDIS_URL'>;

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
      ],
      module: AppModule,
    };
  }
}
