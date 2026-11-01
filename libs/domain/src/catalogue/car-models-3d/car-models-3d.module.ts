import { Module } from '@nestjs/common';

import { CarModels3dController } from './car-models-3d.controller';
import { CarModels3dService } from './car-models-3d.service';
import { CacheModule } from '../../cache/cache.module';
import { Models3dStore } from '../models-3d/models-3d.store';

// The client comes from the global AuthModule, the store from StorageModule.
@Module({
  controllers: [CarModels3dController],
  exports: [Models3dStore],
  imports: [CacheModule],
  providers: [CarModels3dService, Models3dStore],
})
export class CarModels3dModule {}
