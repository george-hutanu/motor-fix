import { Module } from '@nestjs/common';

import { DailyFiguresService } from './daily/daily.service';
import { GarageFiguresController } from './garage-figures.controller';
import { GarageFiguresService } from './garage-figures.service';
import { WorkshopModule } from '../../workshop/workshop.module';

// The garage's figures over HTTP, the free starts from the workshop. Needs the
// global AuthModule for its database.
@Module({
  controllers: [GarageFiguresController],
  imports: [WorkshopModule],
  providers: [DailyFiguresService, GarageFiguresService],
})
export class GarageFiguresModule {}
