import { Module } from '@nestjs/common';

import { DemandController } from './demand.controller';

// The admin's demand read. Needs the global AuthModule for its database.
@Module({ controllers: [DemandController] })
export class DemandModule {}
