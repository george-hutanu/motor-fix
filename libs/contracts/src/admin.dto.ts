import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { CITY_ALL, CITY_KEY, PERIODS, type Period } from './figure-choices';
import { LOCALITY_MAX } from './place-section';

export { CITY_ALL, CITY_KEY, PERIODS, type Period } from './figure-choices';

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

  @ApiProperty({
    description: 'Review reports waiting for an admin, on the whole platform',
    minimum: 0,
    type: 'integer',
  })
  reportsPending!: number;

  @ApiProperty({
    description: 'Of those, the ones past their due time',
    minimum: 0,
    type: 'integer',
  })
  reportsOverdue!: number;

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
      'Quote requests created in the chosen period (the current Europe/Bucharest month by default); a request to several garages once; in a city, those with a recipient garage there',
    minimum: 0,
    type: 'integer',
  })
  requestsSent!: number;

  @ApiPropertyOptional({
    description:
      'Share of garage recipients of the last 30 days that quoted or declined within 24 hours, all hours, rounded down; absent when no recipient counted',
    maximum: 100,
    minimum: 0,
    type: 'integer',
  })
  answerRate?: number;

  @ApiProperty({
    description:
      'Bookings confirmed in the chosen period (the current Europe/Bucharest month by default); in a city, those at a garage there',
    minimum: 0,
    type: 'integer',
  })
  bookings!: number;

  @ApiProperty({
    description:
      'The whole country first, then every city with a listed garage, most garages first',
    type: [AdminCityDto],
  })
  cities!: AdminCityDto[];

  @ApiPropertyOptional({
    description:
      "The MotorFix overview dashboard in Grafana for this API's environment, absent when Grafana is not configured",
    format: 'uri',
  })
  observabilityUrl?: string;
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

export class AdminDemandBrandDto {
  @ApiProperty({
    description:
      "The brand as stored in the request's car snapshot, not normalised; may be empty",
    example: 'Dacia',
  })
  name!: string;

  @ApiProperty({
    description:
      'Requests for the brand in the window; 0 for a brand only searched',
    example: 412,
    minimum: 0,
    type: 'integer',
  })
  requests!: number;

  @ApiProperty({
    description:
      'Logged searches for the brand in the window; 0 for a brand only requested',
    example: 8900,
    minimum: 0,
    type: 'integer',
  })
  searches!: number;
}

export class AdminDemandJobDto {
  @ApiProperty({ description: "The job type's key", example: 'brakes' })
  key!: string;

  @ApiProperty({ example: 'Frâne' })
  nameRo!: string;

  @ApiProperty({ example: 'Brakes' })
  nameEn!: string;

  @ApiProperty({
    description: 'Requests that asked for the job in the window',
    example: 288,
    minimum: 1,
    type: 'integer',
  })
  requests!: number;
}

// What drivers asked for in the last 30 Europe/Bucharest days; counts and
// catalogue names only.
export class AdminDemandDto {
  @ApiProperty({
    description: "The window's first Europe/Bucharest day",
    example: '2026-09-18',
    format: 'date',
  })
  firstDay!: string;

  @ApiProperty({
    description: "The window's last day: today in Europe/Bucharest",
    example: '2026-10-17',
    format: 'date',
  })
  lastDay!: string;

  @ApiProperty({
    description: 'Requests created in the window',
    example: 1240,
    minimum: 0,
    type: 'integer',
  })
  requests!: number;

  @ApiProperty({
    description:
      "Searches logged in the window; the sum of the brands' searches",
    example: 12900,
    minimum: 0,
    type: 'integer',
  })
  searches!: number;

  @ApiPropertyOptional({
    description:
      'The Europe/Bucharest day searches are counted from, when it falls after firstDay: the day of the earliest logged search, or lastDay when none was ever logged',
    example: '2026-10-11',
    format: 'date',
  })
  searchesFrom?: string;

  @ApiProperty({
    description:
      'Every brand searched or requested in the window, most searched first, then most requested, then by name in code-point order',
    type: [AdminDemandBrandDto],
  })
  brands!: AdminDemandBrandDto[];

  @ApiProperty({
    description:
      'Every job type asked for in the window, most first, then by key in code-point order',
    type: [AdminDemandJobDto],
  })
  jobs!: AdminDemandJobDto[];
}

const AREA_KINDS = ['city', 'sector', 'unknown'] as const;
type AreaKind = (typeof AREA_KINDS)[number];

// The demand against supply read's filters; both may be given.
export class AdminDemandSupplyQueryDto {
  @ApiPropertyOptional({
    description: "Only this brand's rows: the exact brand name",
    example: 'BMW',
    maxLength: 80,
    minLength: 1,
  })
  // Absent only: a null brand is refused, as @IsOptional would let it by.
  @ValidateIf((_, value) => value !== undefined)
  @Length(1, 80)
  // PostgreSQL cannot hold a NUL in text; no brand name has a control character.
  @Matches(/^\P{Cc}*$/u)
  brand?: string;

  @ApiPropertyOptional({
    description:
      "Only this area's rows: an area code from the answer's areas, or unknown; a code in no area answers validation_failed",
    example: 'sector-3',
    pattern: '^(unknown|[a-z0-9]+(-[a-z0-9]+)*)$',
  })
  @IsOptional()
  @Matches(/^(unknown|[a-z0-9]+(-[a-z0-9]+)*)$/)
  area?: string;
}

export class AdminAreaDto {
  @ApiProperty({
    description: "The area's code; unknown for a point in no area",
    example: 'sector-3',
  })
  code!: string;

  @ApiProperty({ example: 'Sector 3' })
  name!: string;

  @ApiProperty({ enum: AREA_KINDS, example: 'sector' })
  kind!: AreaKind;
}

export class AdminDemandSupplyRowDto {
  @ApiProperty({
    description: "The request snapshot's or the catalogue brand's exact name",
    example: 'BMW',
  })
  brand!: string;

  @ApiProperty({ type: AdminAreaDto })
  area!: AdminAreaDto;

  @ApiProperty({
    description: "Searches in the window whose cell's centre lies in the area",
    example: 420,
    minimum: 0,
    type: 'integer',
  })
  searches!: number;

  @ApiProperty({
    description:
      'Requests created in the window with a recipient in the area, once per request',
    example: 96,
    minimum: 0,
    type: 'integer',
  })
  requests!: number;

  @ApiProperty({
    description:
      'Requests to the area closed expired in the window with no quote from any garage, on the day they expired; may exceed requests',
    example: 12,
    minimum: 0,
    type: 'integer',
  })
  unmet!: number;

  @ApiProperty({
    description:
      'Approved garages in the area today that work on the brand; a mobile mechanic by its seat',
    example: 4,
    minimum: 0,
    type: 'integer',
  })
  supply!: number;

  @ApiProperty({
    description:
      'Requests divided by supply, rounded to the nearest whole number; null when supply is 0',
    example: 24,
    minimum: 0,
    nullable: true,
    type: 'integer',
  })
  requestsPerGarage!: number | null;
}

// What drivers asked for in each area against the garages there, per brand,
// over the last 30 Europe/Bucharest days; counts and catalogue names only.
export class AdminDemandSupplyDto {
  @ApiProperty({
    description: "The window's first Europe/Bucharest day",
    example: '2026-10-02',
    format: 'date',
  })
  firstDay!: string;

  @ApiProperty({
    description: "The window's last day: today in Europe/Bucharest",
    example: '2026-10-31',
    format: 'date',
  })
  lastDay!: string;

  @ApiProperty({
    description:
      "The latest nightly write of the window's brand-area rows; null before the first",
    example: '2026-10-31T01:00:12.345Z',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  writtenAt!: string | null;

  @ApiProperty({
    description:
      'Every area by code, then unknown; unfiltered, for the area filter',
    type: [AdminAreaDto],
  })
  areas!: AdminAreaDto[];

  @ApiProperty({
    description:
      'One row per brand and area with a search, a request or an unmet request in the window, after the filters; most unmet first, then most searched, then most requested, then by brand and area name in code-point order',
    type: [AdminDemandSupplyRowDto],
  })
  rows!: AdminDemandSupplyRowDto[];
}
