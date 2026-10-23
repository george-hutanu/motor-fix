import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { calendarDay } from './cars.dto';
import { NOTE_TEXT } from './note-text';

export const SUSPENSION_CAUSES = [
  'recheck_failed',
  'documents_overdue',
  'admin',
  'report_confirmed',
] as const;
export type SuspensionCause = (typeof SUSPENSION_CAUSES)[number];

export const SUSPENSION_REASON_MAX = 200;
export const SUSPENSION_LIFT_NOTE_MAX = 1000;

const NO_CONTROL = /^\P{Cc}*$/u;

export class SuspendGarageDto {
  @ApiProperty({ enum: SUSPENSION_CAUSES })
  @IsIn(SUSPENSION_CAUSES)
  cause!: SuspensionCause;

  @ApiProperty({
    description: 'Trimmed; shown to the garage as written',
    maxLength: SUSPENSION_REASON_MAX,
    minLength: 1,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, SUSPENSION_REASON_MAX)
  @Matches(NO_CONTROL, { message: 'reason must not hold control characters' })
  reason!: string;
}

export class GarageSuspensionCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ enum: SUSPENSION_CAUSES })
  cause!: SuspensionCause;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ format: 'date-time' })
  fromTime!: string;
}

// The RAR look-up an admin records while putting a garage back on the map;
// whether its codes are known and fit the garage is the use case's 422.
export class RestoreRecheckDto {
  @ApiProperty({
    description:
      "The Bucharest day of the look-up: after the garage's last check, not after today",
    format: 'date',
  })
  @calendarDay()
  checkedOn!: string;

  @ApiProperty({
    description:
      "The rar_activity codes the authorisation covers, a non-empty part of the garage's current set",
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  activities!: string[];
}

const sent = (_: object, value: unknown) => value !== undefined;

export class RestoreGarageDto {
  @ApiPropertyOptional({
    description:
      'Trimmed; line breaks allowed; required when the cause is admin or report_confirmed',
    maxLength: SUSPENSION_LIFT_NOTE_MAX,
    minLength: 1,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(sent)
  @IsString()
  @Length(1, SUSPENSION_LIFT_NOTE_MAX)
  @Matches(NOTE_TEXT, { message: 'note must not hold control characters' })
  note?: string;

  @ApiPropertyOptional({
    description: 'A valid RAR re-check; only for the cause recheck_failed',
    type: RestoreRecheckDto,
  })
  @ValidateIf(sent)
  @IsObject()
  @ValidateNested()
  @Type(() => RestoreRecheckDto)
  recheck?: RestoreRecheckDto;
}

export class SuspensionLifterDto {
  @ApiProperty({ description: "First name and the family name's initial" })
  name!: string;
}

export class GarageRestoredDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ enum: SUSPENSION_CAUSES })
  cause!: SuspensionCause;

  @ApiProperty({ format: 'date-time' })
  fromTime!: string;

  @ApiProperty({ format: 'date-time' })
  untilTime!: string;

  @ApiProperty({ type: SuspensionLifterDto })
  liftedBy!: SuspensionLifterDto;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({
    description:
      "The inline re-check's day, else the garage's current one; null when never checked",
    format: 'date',
    nullable: true,
    type: String,
  })
  lastCheckedOn!: string | null;
}
