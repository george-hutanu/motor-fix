import { ApiProperty } from '@nestjs/swagger';

// One complete ISO week of the garage's figures, on the Bucharest clock. The
// three figures are null for a week before the garage's approval.
export class WeeklyFigureDto {
  @ApiProperty({ example: '2026-W40' })
  key!: string;

  @ApiProperty({ description: 'The Monday', example: '2026-09-28' })
  from!: string;

  @ApiProperty({ description: 'The Sunday', example: '2026-10-04' })
  to!: string;

  @ApiProperty({
    description: 'Distinct profile visitors',
    nullable: true,
    type: Number,
  })
  views!: number | null;

  @ApiProperty({
    description: 'Requests that reached the garage',
    nullable: true,
    type: Number,
  })
  requests!: number | null;

  @ApiProperty({
    description:
      'Requests per hundred views, one decimal, at most 100; null without views',
    nullable: true,
    type: Number,
  })
  conversion!: number | null;
}

// The eight complete weeks before the current one, oldest first.
export class WeeklyFiguresDto {
  @ApiProperty({ type: [WeeklyFigureDto] })
  weeks!: WeeklyFigureDto[];
}

// The first day of the current week with a start still free.
export class NextFreeSlotsDto {
  @ApiProperty({ example: '2026-11-06' })
  day!: string;

  @ApiProperty({ description: 'Starts free that day, at most 10', example: 4 })
  count!: number;
}

// The garage's four numbers of the day, on the Bucharest clock.
export class TodayFiguresDto {
  @ApiProperty({ description: 'Requests that reached the garage today' })
  requestsToday!: number;

  @ApiProperty({ description: 'Requests that reached the garage yesterday' })
  requestsYesterday!: number;

  @ApiProperty({
    description: 'Confirmed or completed bookings starting this week',
  })
  bookingsThisWeek!: number;

  @ApiProperty({ description: 'The same bookings, starting today' })
  bookingsToday!: number;

  @ApiProperty({
    description: 'Null when no start is free before Sunday ends',
    nullable: true,
    type: NextFreeSlotsDto,
  })
  nextFreeSlots!: NextFreeSlotsDto | null;

  @ApiProperty({
    description: 'True when the free starts could not be read just now',
  })
  freeSlotsUnavailable!: boolean;

  @ApiProperty({ example: 4.9, nullable: true, type: Number })
  rating!: number | null;

  @ApiProperty({ example: 212 })
  reviewCount!: number;

  @ApiProperty({
    description:
      'Work won this month: final prices, else the middle of the accepted range',
    example: 153000,
  })
  estimatedWorkBani!: number;

  @ApiProperty({
    description: 'The first day of the month',
    example: '2026-12-01',
  })
  month!: string;
}
