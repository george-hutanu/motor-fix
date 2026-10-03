import { DynamicModule, Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HEALTH_OPTIONS, HealthOptions, HealthService } from './health.service';

@Module({})
export class HealthModule {
  static register(options: HealthOptions): DynamicModule {
    return {
      controllers: [HealthController],
      module: HealthModule,
      providers: [
        HealthService,
        { provide: HEALTH_OPTIONS, useValue: options },
      ],
    };
  }
}
