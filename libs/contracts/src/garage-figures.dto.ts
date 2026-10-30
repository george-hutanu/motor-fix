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
