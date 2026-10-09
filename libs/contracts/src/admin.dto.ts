import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches, MaxLength } from 'class-validator';

import { LOCALITY_MAX } from './place-section';

// `default` keeps each figure's own period; every other one ends today.
export const PERIODS = [
  'default',
  'today',
  '7d',
  '30d',
  'month',
  '12m',
] as const;
export type Period = (typeof PERIODS)[number];
// The whole country: every garage, a city known or not.
export const CITY_ALL = 'all';
export const CITY_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class AdminGrowthQueryDto {
  @ApiPropertyOptional({
    default: CITY_ALL,
    description: "A key from the overview's cities, or all",
    maxLength: LOCALITY_MAX,
    pattern: CITY_KEY.source,
  })
  @IsOptional()
  @Matches(CITY_KEY)
  @MaxLength(LOCALITY_MAX)
  city?: string;
}

export class AdminOverviewQueryDto extends AdminGrowthQueryDto {
  @ApiPropertyOptional({ default: 'default', enum: PERIODS })
  @IsOptional()
  @IsIn(PERIODS)
  period?: Period;
}

export class AdminCityDto {
  @ApiProperty({ example: 'cluj-napoca', pattern: CITY_KEY.source })
  key!: string;

  @ApiProperty({ example: 'Cluj-Napoca' })
  name!: string;

  @ApiProperty({
    description: 'Garages approved and listed now in the city',
    minimum: 0,
    type: 'integer',
  })
  garages!: number;
}

// Counted at each call, never stored.
export class AdminOverviewDto {
  @ApiProperty({
    description:
      'Verification files submitted or in review, on the whole platform',
    minimum: 0,
    type: 'integer',
  })
  garagesWaiting!: number;

  @ApiPropertyOptional({
    description:
      'Verification files submitted or in review of garages in the chosen city; only with a city',
    minimum: 0,
    type: 'integer',
  })
  cityGaragesWaiting?: number;

  @ApiProperty({
    description: 'Garages approved and listed now',
    minimum: 0,
    type: 'integer',
  })
  garagesListed!: number;

  @ApiProperty({
    description:
      'Listed garages first approved in the current Europe/Bucharest month',
    minimum: 0,
    type: 'integer',
  })
  garagesApprovedThisMonth!: number;

  @ApiProperty({
    description: 'Active driver accounts used in the last 30 days',
    minimum: 0,
    type: 'integer',
  })
  activeDrivers!: number;

  @ApiPropertyOptional({
    description:
      'Active drivers on the 1st of the current month, absent when that night was not recorded',
    minimum: 0,
    type: 'integer',
  })
  activeDriversMonthStart?: number;

  @ApiPropertyOptional({
    description:
      'Listed garages first approved in the chosen period; only with a period',
    minimum: 0,
    type: 'integer',
  })
  garagesApprovedInPeriod?: number;

  @ApiPropertyOptional({
    description:
      'Active drivers on the first day of the chosen period, absent for today, a city or a night not recorded',
    minimum: 0,
    type: 'integer',
  })
  activeDriversPeriodStart?: number;

  @ApiProperty({
    description:
      'The whole country first, then every city with a listed garage, most garages first',
    type: [AdminCityDto],
  })
  cities!: AdminCityDto[];
}

export class AdminGrowthMonthDto {
  @ApiProperty({
    description: 'The Europe/Bucharest month',
    example: '2026-03',
    pattern: '^\\d{4}-\\d{2}$',
  })
  month!: string;

  @ApiPropertyOptional({
    description:
      'Active drivers at the month’s close, live for the current month; absent when the close was not recorded',
    minimum: 0,
    type: 'integer',
  })
  activeDrivers?: number;

  @ApiPropertyOptional({
    description:
      'Garages listed at the month’s close, live for the current month; absent when the close was not recorded',
    minimum: 0,
    type: 'integer',
  })
  garagesListed?: number;
}

export class AdminGrowthDto {
  @ApiProperty({
    description:
      'The last twelve months, oldest first, ending with the current one',
    type: [AdminGrowthMonthDto],
  })
  months!: AdminGrowthMonthDto[];
}
