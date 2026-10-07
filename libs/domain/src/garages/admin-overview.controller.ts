import { AdminOverviewDto } from '@motor-fix/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { VerificationService } from './verification.service';
import { Requires } from '../auth/actor.guard';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import {
  countPlatformFigures,
  monthStartSnapshot,
} from '../insights/platform-figures';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminOverviewController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly verification: VerificationService,
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
    };
  }
}
