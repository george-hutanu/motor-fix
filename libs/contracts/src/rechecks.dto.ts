import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

import { calendarDay } from './cars.dto';
import { RarActivityNameDto } from './legal-check.dto';
import { RECHECK_DETAIL_MAX } from './verification-target';

// A garage is due this many Bucharest days after its last check, and
// overdue past the other.
export const RECHECK_DUE_AFTER_DAYS = 28;
export const RECHECK_MAX_AGE_DAYS = 31;

export const RECHECK_RESULTS = ['ok', 'failed'] as const;
export type RecheckResult = (typeof RECHECK_RESULTS)[number];
const RECHECK_FAILURES = ['expired', 'suspended', 'withdrawn'] as const;
export type RecheckFailure = (typeof RECHECK_FAILURES)[number];

const NO_CONTROL = /^\P{Cc}*$/u;

// The field belongs to that result only; sent with the other it is refused.
const onlyWith = (result: RecheckResult) =>
  ValidateBy({
    name: 'onlyWith',
    validator: {
      defaultMessage: (args) =>
        `${args?.property} is sent only with the result ${result}`,
      validate: (_, args) =>
        (args?.object as { result?: unknown } | undefined)?.result === result,
    },
  });

const sentOrNeeded =
  (result: RecheckResult, field: 'activities' | 'failure') =>
  (dto: RecordRecheckDto) =>
    dto.result === result || dto[field] !== undefined;

// Whether a detail belongs and its length are the use case's 422, so the
// story's "a failure without a detail is 422" holds; here only its shape.
export class RecordRecheckDto {
  @ApiProperty({ enum: RECHECK_RESULTS })
  @IsIn(RECHECK_RESULTS)
  result!: RecheckResult;

  @ApiPropertyOptional({
    description: 'Which way the authorisation failed; failed only',
    enum: RECHECK_FAILURES,
  })
  @ValidateIf(sentOrNeeded('failed', 'failure'))
  @IsIn(RECHECK_FAILURES)
  @onlyWith('failed')
  failure?: RecheckFailure;

  @ApiProperty({
    description:
      'The Bucharest day of the look-up: after the last check, not after today',
    format: 'date',
  })
  @calendarDay()
  checkedOn!: string;

  @ApiPropertyOptional({
    description:
      "The rar_activity codes the authorisation covers, a non-empty part of the garage's current set; ok only",
    type: [String],
  })
  @ValidateIf(sentOrNeeded('ok', 'activities'))
  @IsArray()
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  @onlyWith('ok')
  activities?: string[];

  @ApiPropertyOptional({
    description: `Trimmed; 1 to ${RECHECK_DETAIL_MAX} characters, required on a failure and refused on ok`,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_: object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(NO_CONTROL, { message: 'detail must not hold control characters' })
  detail?: string;

  @ApiProperty({
    description:
      "The garage's date of last check the admin's row showed, or null; a moved date is refused",
    format: 'date',
    nullable: true,
    type: String,
  })
  @ValidateIf((_: object, value: unknown) => value !== null)
  @calendarDay()
  lastCheckedOn!: string | null;
}

export class RecheckDueRowDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: "The newest verification file's RAR number",
    nullable: true,
    type: String,
  })
  rarNumber!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  lastCheckedOn!: string | null;

  @ApiProperty({
    description: 'Whole Bucharest days since the last check',
    nullable: true,
    type: Number,
  })
  daysSince!: number | null;

  @ApiProperty({
    description: `Last checked more than ${RECHECK_MAX_AGE_DAYS} days ago, or never`,
  })
  overdue!: boolean;

  @ApiProperty({
    description: "The garage's current rar_activity codes",
    type: [String],
  })
  activities!: string[];

  @ApiProperty({
    description:
      'The current codes the catalogue knows, by name, for the record form',
    type: [RarActivityNameDto],
  })
  activityNames!: RarActivityNameDto[];
}

export class RecheckDueListDto {
  @ApiProperty({
    description: 'The Bucharest day the list was read for',
    format: 'date',
  })
  today!: string;

  @ApiProperty({
    description:
      'Every due garage, the oldest check first and never-checked ones before all',
    type: [RecheckDueRowDto],
  })
  items!: RecheckDueRowDto[];
}

export class RecheckRecordedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ enum: RECHECK_RESULTS })
  result!: RecheckResult;

  @ApiProperty({ format: 'date' })
  checkedOn!: string;

  @ApiProperty({
    description: "The garage's date of last check after the save",
    format: 'date',
    nullable: true,
    type: String,
  })
  lastCheckedOn!: string | null;

  @ApiProperty({ enum: ['approved', 'suspended'] })
  status!: 'approved' | 'suspended';
}
