import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { CacheService } from './cache.service';
import { HttpCacheInterceptor } from './http-cache/http-cache.interceptor';

// The Redis client comes from the global AuthModule.
@Module({
  exports: [CacheService],
  providers: [
    CacheService,
    { provide: APP_INTERCEPTOR, useClass: HttpCacheInterceptor },
  ],
})
export class CacheModule {}
