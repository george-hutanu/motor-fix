import { type AppEnv, placesApiKey } from '@motor-fix/contracts';
import { type DynamicModule, Logger, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { PlacesController } from './lookup/places.controller';
import { PlacesThrottle } from './lookup/places.throttle';
import { FakePlaces } from './providers/fake-places.provider';
import { GeoapifyPlaces } from './providers/geoapify-places.provider';
import {
  PLACES_PROVIDER,
  type PlacesProvider,
} from './providers/places.provider';
import { AUTH_REDIS } from '../auth/attempts';

export type PlacesConfig =
  | { provider: 'geoapify'; apiKey: string }
  | { provider: 'fake' }
  | { provider: 'none' };

// Chosen once at boot: the key wins; tests without one get the stand-in;
// anywhere else without one the look-up says it is down.
export function placesConfig(
  appEnv: AppEnv,
  source: Record<string, string | undefined>,
): PlacesConfig {
  const apiKey = placesApiKey(source);
  if (apiKey) return { apiKey, provider: 'geoapify' };
  return appEnv === 'test' ? { provider: 'fake' } : { provider: 'none' };
}

const NONE: PlacesProvider = {
  name: 'none',
  search: async () => ({ unavailable: 'not_configured' }),
};

function providerFor(config: PlacesConfig): PlacesProvider {
  const logger = new Logger('Places');
  if (config.provider === 'none') {
    logger.warn('address search off: GEOAPIFY_API_KEY is not set');
    return NONE;
  }
  const provider =
    config.provider === 'geoapify'
      ? new GeoapifyPlaces(config.apiKey)
      : new FakePlaces();
  logger.log(`address search: ${provider.name}`);
  return provider;
}

// The address look-up the listing form uses; the drivers' search reuses it.
// Needs the global AuthModule for its Redis.
@Module({})
export class PlacesModule {
  static register(config: PlacesConfig): DynamicModule {
    return {
      controllers: [PlacesController],
      module: PlacesModule,
      providers: [
        { provide: PLACES_PROVIDER, useValue: providerFor(config) },
        {
          inject: [AUTH_REDIS],
          provide: PlacesThrottle,
          useFactory: (redis: Redis) => new PlacesThrottle(redis),
        },
      ],
    };
  }
}
