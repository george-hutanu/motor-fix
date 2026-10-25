import { type DynamicModule, Logger, Module } from '@nestjs/common';

import { StaticMapController } from './static-map/static-map.controller';
import { StaticMapRenderer } from './static-map/static-map.renderer';

export interface MapsConfig {
  // The provider's TileJSON, or 'off' to draw the ground only.
  tileJsonUrl: string;
}

// The map pictures the search shows before the interactive map loads. Needs
// the global AuthModule for its rate limits.
@Module({})
export class MapsModule {
  static register(config: MapsConfig): DynamicModule {
    if (config.tileJsonUrl === 'off') {
      new Logger('Maps').warn(
        'static maps draw the ground only: MAP_TILES_TILEJSON_URL is off',
      );
    }
    return {
      controllers: [StaticMapController],
      module: MapsModule,
      providers: [
        {
          provide: StaticMapRenderer,
          useValue: new StaticMapRenderer(config.tileJsonUrl),
        },
      ],
    };
  }
}
