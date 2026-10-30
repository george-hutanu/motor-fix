import { Module } from '@nestjs/common';

import { GarageFiguresController } from './garage-figures.controller';
import { GarageFiguresService } from './garage-figures.service';

// The garage's figures over HTTP. Needs the global AuthModule for its
// database.
@Module({
  controllers: [GarageFiguresController],
  providers: [GarageFiguresService],
})
export class GarageFiguresModule {}
