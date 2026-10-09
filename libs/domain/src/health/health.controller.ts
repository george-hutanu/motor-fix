import { HealthLiveDto, HealthReadyDto } from '@motor-fix/contracts';
import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthService } from './health.service';
import { OpenInMaintenance, Public } from '../auth/actor.guard';

@ApiTags('health')
@Controller('health')
@Public()
@OpenInMaintenance()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOkResponse({ type: HealthLiveDto })
  live(): HealthLiveDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthReadyDto })
  @ApiServiceUnavailableResponse({ type: HealthReadyDto })
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReadyDto> {
    const report = await this.health.ready();
    if (report.status === 'error') res.status(503);
    return report;
  }
}
