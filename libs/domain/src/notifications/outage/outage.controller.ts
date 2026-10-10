import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { readAlerts } from './outage';
import { OUTAGE_WEBHOOK_TOKEN, OutageService } from './outage.service';
import { OpenInMaintenance, Public } from '../../auth/actor.guard';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Grafana Cloud's outage contact point; it sends the configured bearer token,
// not a session, and must get through while the app is in maintenance.
@ApiExcludeController()
@Controller('monitoring/outage-alerts')
@Public()
@OpenInMaintenance()
export class OutageController {
  constructor(
    private readonly outage: OutageService,
    @Inject(OUTAGE_WEBHOOK_TOKEN) private readonly token: string,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const given = authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (
      !this.token ||
      !given ||
      !timingSafeEqual(digest(given), digest(this.token))
    ) {
      throw new HttpException(
        { code: 'sign_in_required', message: 'Unknown webhook caller' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const alerts = readAlerts(body);
    if (!alerts) {
      throw new HttpException(
        { code: 'validation_failed', message: 'Not a Grafana alert payload' },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.outage.handle(alerts);
  }
}
