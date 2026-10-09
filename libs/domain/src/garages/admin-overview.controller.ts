import {
  AdminGrowthDto,
  AdminGrowthQueryDto,
  AdminOverviewDto,
  AdminOverviewQueryDto,
  CITY_ALL,
} from '@motor-fix/contracts';
import { Controller, Get, HttpStatus, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { VerificationService } from './verification/verification.service';
import { Requires } from '../auth/actor.guard';
import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import type { PrismaClient } from '../generated/prisma/client';
import { periodRange } from '../insights/periods';
import {
  cities,
  countPlatformFigures,
  monthStartSnapshot,
  readGrowth,
  snapshotActiveDrivers,
} from '../insights/platform-figures';

const unknownCity = () =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', 'Unknown city', [
    { code: 'unknown', field: 'city' },
  ]);

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
  @ApiBadRequestResponse({
    description: 'validation_failed: an unknown city or period',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  async overview(
    @Query() { city = CITY_ALL, period = 'default' }: AdminOverviewQueryDto,
  ): Promise<AdminOverviewDto> {
    const now = new Date();
    const list = await cities(this.prisma);
    if (!list.some(({ key }) => key === city)) throw unknownCity();
    const whole = city === CITY_ALL;
    // A city's rows hold no active drivers, and today's would be today's own.
    const start = whole && period !== 'today' && periodRange(period, now);
    const [
      garagesWaiting,
      cityGaragesWaiting,
      figures,
      activeDriversMonthStart,
      activeDriversPeriodStart,
    ] = await Promise.all([
      this.verification.countWaiting(this.prisma),
      whole ? undefined : this.verification.countWaiting(this.prisma, city),
      countPlatformFigures(this.prisma, now, { city, period }),
      whole ? monthStartSnapshot(this.prisma, now) : undefined,
      start ? snapshotActiveDrivers(this.prisma, start.firstDay) : undefined,
    ]);
    return {
      garagesWaiting,
      ...(cityGaragesWaiting !== undefined && { cityGaragesWaiting }),
      ...figures,
      ...(activeDriversMonthStart !== undefined && { activeDriversMonthStart }),
      ...(activeDriversPeriodStart !== undefined && {
        activeDriversPeriodStart,
      }),
      cities: list,
    };
  }

  @Get('growth')
  @Requires('admin.garages')
  @ApiOkResponse({ type: AdminGrowthDto })
  @ApiBadRequestResponse({ description: 'validation_failed: an unknown city' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  async growth(
    @Query() { city = CITY_ALL }: AdminGrowthQueryDto,
  ): Promise<AdminGrowthDto> {
    if (!(await cities(this.prisma)).some(({ key }) => key === city))
      throw unknownCity();
    return readGrowth(this.prisma, new Date(), city);
  }
}
