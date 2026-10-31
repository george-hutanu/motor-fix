import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const FREE_SLOTS_DURATION_MIN = 15;
export const FREE_SLOTS_DURATION_MAX = 2400;
const FREE_SLOTS_COUNT_MAX = 10;
const FREE_SLOTS_HORIZON_MAX = 30;

// An instant: a date, a time and its zone, so no server clock reads it.
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// Only the digits as written: Number() would also read "1e2", "0x10" or ""
// as a number, and those are refused as they came.
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

// The question a free-slot read answers: how long the job is, what it needs,
// and from when and how far to look.
export class FreeSlotsQueryDto {
  @ApiProperty({
    description: 'Minutes the job takes',
    maximum: FREE_SLOTS_DURATION_MAX,
    minimum: FREE_SLOTS_DURATION_MIN,
    type: 'integer',
  })
  @Transform(digits)
  @IsInt()
  @Min(FREE_SLOTS_DURATION_MIN)
  @Max(FREE_SLOTS_DURATION_MAX)
  duration!: number;

  @ApiPropertyOptional({
    description:
      'The jobs of the work; any of them needing a lift makes the job need one',
    format: 'uuid',
    isArray: true,
    type: String,
  })
  // A single key arrives as a string, a repeated one as a list.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  @IsArray()
  @IsUUID('all', { each: true })
  jobTypeIds?: string[];

  @ApiPropertyOptional({
    description: 'The job needs a lift, whatever its job types say',
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  needsLift?: boolean;

  @ApiPropertyOptional({
    description:
      'The first start to offer; an hour from now when left out, now when past, rounded up to the next half hour of the Bucharest clock',
    format: 'date-time',
  })
  @IsOptional()
  @Matches(INSTANT)
  @IsISO8601({ strict: true })
  earliest?: string;

  @ApiPropertyOptional({
    default: FREE_SLOTS_HORIZON_MAX,
    description:
      "Bucharest days to look through, the earliest start's day the first",
    maximum: FREE_SLOTS_HORIZON_MAX,
    minimum: 1,
    type: 'integer',
  })
  @Transform(digits)
  @IsInt()
  @Min(1)
  @Max(FREE_SLOTS_HORIZON_MAX)
  horizonDays: number = FREE_SLOTS_HORIZON_MAX;

  @ApiPropertyOptional({
    default: 3,
    description: 'Starts to answer at most',
    maximum: FREE_SLOTS_COUNT_MAX,
    minimum: 1,
    type: 'integer',
  })
  @Transform(digits)
  @IsInt()
  @Min(1)
  @Max(FREE_SLOTS_COUNT_MAX)
  count: number = 3;

  @ApiPropertyOptional({
    description:
      'Only the starts at which this current card of the garage is free; refused while the team is off',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  mechanicId?: string;

  @ApiPropertyOptional({
    description:
      "A booking of the garage whose own time does not block, as when it is moved; a driver's must be hers",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  excludeBookingId?: string;
}

export class FreeSlotDto {
  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({
    description: 'Where the job ends, over every working day it takes',
    format: 'date-time',
  })
  endsAt!: string;
}

export class FreeSlotsDto {
  @ApiProperty({
    description: 'Ascending by start, at most the count asked for',
    type: [FreeSlotDto],
  })
  slots!: FreeSlotDto[];

  @ApiPropertyOptional({
    description: 'Present only when no start fits inside the horizon',
    enum: ['none_in_horizon'],
  })
  reason?: 'none_in_horizon';
}
