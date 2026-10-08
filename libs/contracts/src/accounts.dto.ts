import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { ROLE } from './me.dto';

const COUNT_KIND = ['requests', 'reviews', 'age'] as const;
const STATUS = ['active', 'suspended'] as const;

export class AdminAccountsQueryDto {
  // The length is checked with the rest of the cursor, so a long one answers
  // invalid_cursor like any other cursor this list never gave out.
  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class AdminAccountCountDto {
  @ApiProperty({
    description:
      'requests for a driver, reviews for a garage or mechanic, age in days for a receptionist, an admin or an account under 7 days old',
    enum: COUNT_KIND,
  })
  kind!: (typeof COUNT_KIND)[number];

  @ApiProperty({ minimum: 0, type: 'integer' })
  value!: number;
}

// Nothing about the person beyond the name: no e-mail, phone or plate.
export class AdminAccountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'In the order driver, garage, receptionist, mechanic, admin',
    enum: ROLE,
    isArray: true,
  })
  roles!: (typeof ROLE)[number][];

  @ApiProperty({
    description:
      'The garage of the first role: owned, worked at as receptionist, or of the mechanic card',
    nullable: true,
    type: String,
  })
  garageName!: string | null;

  @ApiProperty({ description: 'Cars not removed', minimum: 0, type: 'integer' })
  carsCount!: number;

  @ApiProperty({ enum: STATUS })
  status!: (typeof STATUS)[number];

  @ApiProperty({
    description:
      'When the state began: creation for active, the last recorded suspension for suspended (null when none is recorded)',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  since!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: AdminAccountCountDto })
  count!: AdminAccountCountDto;
}

export class AdminAccountsPageDto {
  @ApiProperty({
    description: 'Newest first, 20 at most',
    type: [AdminAccountDto],
  })
  items!: AdminAccountDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

// Counted at most once a minute, the same for every language.
export class AdminAccountsSummaryDto {
  @ApiProperty({
    description: 'Active driver accounts used in the last 30 days',
    minimum: 0,
    type: 'integer',
  })
  activeDrivers!: number;

  @ApiProperty({
    description: 'Garages approved and listed now',
    minimum: 0,
    type: 'integer',
  })
  garagesListed!: number;

  @ApiProperty({
    description: 'Mechanic cards with an account at listed garages',
    minimum: 0,
    type: 'integer',
  })
  mechanics!: number;
}
