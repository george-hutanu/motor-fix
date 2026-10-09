import { PlatformStatusDto } from '@motor-fix/contracts';
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { OpenInMaintenance, Public } from '../../../auth/actor.guard';
import { MAINTENANCE, type Maintenance } from '../../../auth/maintenance';

@ApiTags('platform')
@Controller('platform-status')
@Public()
@OpenInMaintenance()
export class PlatformStatusController {
  constructor(@Inject(MAINTENANCE) private readonly flag: Maintenance) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: PlatformStatusDto })
  async status(): Promise<PlatformStatusDto> {
    return { maintenance: await this.flag.on() };
  }
}
