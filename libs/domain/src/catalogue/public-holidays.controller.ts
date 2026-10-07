import { PublicHolidayDto, PublicHolidaysQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/actor.guard';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

@ApiTags('public-holidays')
@Controller('public-holidays')
export class PublicHolidaysController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: [PublicHolidayDto] })
  async list(
    @Query() { year }: PublicHolidaysQueryDto,
  ): Promise<PublicHolidayDto[]> {
    const rows = await this.prisma.publicHoliday.findMany({
      orderBy: { day: 'asc' },
      where: {
        day: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    });
    return rows.map(({ day, nameEn, nameRo }) => ({
      day: day.toISOString().slice(0, 10),
      nameEn,
      nameRo,
    }));
  }
}
