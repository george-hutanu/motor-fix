import { AdminGrowthDto, AdminOverviewDto } from '@motor-fix/contracts';
import { Controller, Get, Inject, Optional } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { VerificationService } from './verification/verification.service';
import { Requires } from '../auth/actor.guard';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import {
  countPlatformFigures,
  monthStartSnapshot,
  readGrowth,
} from '../insights/platform-figures';

// The overview's link to the Grafana overview dashboard, built by the API
// from GRAFANA_URL and its own environment.
export const OBSERVABILITY_URL = Symbol('OBSERVABILITY_URL');

export function observabilityUrl(
  grafana: string | undefined,
  env: string,
): string | undefined {
  if (!grafana) return undefined;
  // A Grafana served under a path keeps it, as the release's push does.
  const url = new URL(`${grafana.replace(/\/$/, '')}/d/motorfix-overview`);
  url.searchParams.set('var-env', env);
  return url.href;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminOverviewController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly verification: VerificationService,
    @Optional()
    @Inject(OBSERVABILITY_URL)
    private readonly observabilityUrl?: string,
  ) {}

  @Get('overview')
  @Requires('admin.garages')
  @ApiOkResponse({ type: AdminOverviewDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  async overview(): Promise<AdminOverviewDto> {
    const now = new Date();
    const [garagesWaiting, figures, activeDriversMonthStart] =
      await Promise.all([
        this.verification.countWaiting(this.prisma),
        countPlatformFigures(this.prisma, now),
        monthStartSnapshot(this.prisma, now),
      ]);
    return {
      garagesWaiting,
      ...figures,
      ...(activeDriversMonthStart === undefined
        ? {}
        : { activeDriversMonthStart }),
      ...(this.observabilityUrl
        ? { observabilityUrl: this.observabilityUrl }
        : {}),
    };
  }

  @Get('growth')
  @Requires('admin.garages')
  @ApiOkResponse({ type: AdminGrowthDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  growth(): Promise<AdminGrowthDto> {
    return readGrowth(this.prisma, new Date());
  }
}
