import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ProfileViewsController } from './profile-views.controller';
import { ProfileViewsService } from './profile-views.service';
import { ProfileViewsThrottle } from './profile-views.throttle';
import { AUTH_REDIS } from '../../auth/attempts';

// The public profile's view beacon. Needs the global AuthModule for its
// Redis and its database.
@Module({
  controllers: [ProfileViewsController],
  providers: [
    ProfileViewsService,
    {
      inject: [AUTH_REDIS],
      provide: ProfileViewsThrottle,
      useFactory: (redis: Redis) => new ProfileViewsThrottle(redis),
    },
  ],
})
export class ProfileViewsModule {}
