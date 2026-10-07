import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Counted at each call, never stored.
export class AdminOverviewDto {
  @ApiProperty({
    description: 'Verification files submitted or in review',
    minimum: 0,
    type: 'integer',
  })
  garagesWaiting!: number;

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

// The last twelve months, oldest first, ending with the current one.
export class AdminGrowthDto {
  @ApiProperty({ type: [AdminGrowthMonthDto] })
  months!: AdminGrowthMonthDto[];
}
