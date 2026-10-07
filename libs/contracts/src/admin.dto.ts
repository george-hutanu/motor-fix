import { ApiProperty } from '@nestjs/swagger';

// Counted at each call, never stored.
export class AdminOverviewDto {
  @ApiProperty({
    description: 'Verification files submitted or in review',
    minimum: 0,
    type: 'integer',
  })
  garagesWaiting!: number;
}
