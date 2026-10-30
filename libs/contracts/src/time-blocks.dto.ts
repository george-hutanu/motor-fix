import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';

import { BookingMechanicDto } from './quotes.dto';

export const TIME_BLOCK_NOTE_MAX = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// An instant: a date, a time and its zone, so no server clock reads it.
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// One Bucharest day of a block's range.
export class TimeBlockSegmentDto {
  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  endsAt!: string;
}

// Time the garage holds on a mechanic, a lift or both, for a walk-in or a
// phone booking. The note is for the garage's staff only.
export class TimeBlockDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  // A thunk: quotes.dto imports this file, so the class is not yet defined
  // when this one is decorated.
  @ApiProperty({ nullable: true, type: () => BookingMechanicDto })
  mechanic!: BookingMechanicDto | null;

  @ApiPropertyOptional({
    description: 'Present only while the garage schedules lifts',
    nullable: true,
    type: Number,
  })
  lift?: number | null;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  endsAt!: string;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({
    description: 'One per Bucharest day the range touches',
    type: [TimeBlockSegmentDto],
  })
  segments!: TimeBlockSegmentDto[];
}

export class TimeBlocksDto {
  @ApiProperty({ type: [TimeBlockDto] })
  blocks!: TimeBlockDto[];

  @ApiProperty({ format: 'date' })
  from!: string;

  @ApiProperty({ format: 'date' })
  to!: string;

  @ApiProperty()
  lifts!: boolean;
}

// The blocks over one to 31 Bucharest days.
export class TimeBlocksQueryDto {
  @ApiPropertyOptional({
    description: 'YYYY-MM-DD, Bucharest; today when left out',
    format: 'date',
  })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description:
      'YYYY-MM-DD, Bucharest; from when left out, at most 30 days on',
    format: 'date',
  })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  to?: string;
}

export class CreateTimeBlockDto {
  @ApiPropertyOptional({
    description: 'A current card of the garage; refused while the team is off',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsUUID()
  mechanicId?: string | null;

  @ApiPropertyOptional({
    description:
      "1 to the garage's lift count; refused while it schedules without lifts",
    minimum: 1,
    nullable: true,
    type: Number,
  })
  // 1 and up is the service's 422 naming the field, beside the lift count.
  @IsOptional()
  @IsInt()
  lift?: number | null;

  @ApiProperty({
    description: 'On a quarter hour of the Bucharest clock',
    format: 'date-time',
  })
  @Matches(INSTANT)
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({
    description: '15 minutes to 14 days after the start, and after now',
    format: 'date-time',
  })
  @Matches(INSTANT)
  @IsISO8601({ strict: true })
  endsAt!: string;

  @ApiPropertyOptional({
    description: `Trimmed, at most ${TIME_BLOCK_NOTE_MAX} characters; empty is none`,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  note?: string | null;
}

// Any of the create's fields, over the stored block. The range may be left
// out but never cleared: a null start or end is refused.
export class UpdateTimeBlockDto extends PartialType(
  OmitType(CreateTimeBlockDto, ['startsAt', 'endsAt']),
) {
  @ApiPropertyOptional({
    description: 'On a quarter hour of the Bucharest clock',
    format: 'date-time',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Matches(INSTANT)
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiPropertyOptional({
    description: '15 minutes to 14 days after the start, and after now',
    format: 'date-time',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Matches(INSTANT)
  @IsISO8601({ strict: true })
  endsAt?: string;
}
