import { Global, Module } from '@nestjs/common';

import { HomeWarm } from './home-warm';
import { HOME_WARM } from '../../auth/sign-in.service';
import { CarsModule } from '../../cars/my-cars/cars/cars.module';
import { QuotesModule } from '../../quotes/quotes.module';
import { CacheModule } from '../cache.module';

// The sign-in's warm of the home's reads, which live in the cars and quotes
// modules; the sign-in finds it by its token.
@Global()
@Module({
  exports: [HOME_WARM],
  imports: [CacheModule, CarsModule, QuotesModule],
  providers: [{ provide: HOME_WARM, useClass: HomeWarm }],
})
export class WarmModule {}
