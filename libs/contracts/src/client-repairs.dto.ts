import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { calendarDay, notAfterToday } from './cars.dto';
import { MAX_KM } from './plate';

// The largest amount a repair may carry: 920 000 lei.
const MAX_REPAIR_COST_BANI = 92_000_000;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Sent: checked; a field left out keeps its value. Null is checked too, so a
// field that cannot be cleared refuses it.
const sent = () => ValidateIf((_, value) => value !== undefined);
// Sent and not null: null clears the amount.
const given = () =>
  ValidateIf((_, value) => value !== undefined && value !== null);

// A correction carries only the fields it changes, and the version it read.
export class CorrectClientRepairDto {
  @ApiProperty({
    description: 'The version of the repair as read; an older one is refused',
    format: 'date-time',
  })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T/, { message: 'version must be a date-time' })
  version!: string;

  @ApiPropertyOptional({ description: 'Trimmed', maxLength: 200, minLength: 1 })
  @sent()
  @Transform(trimmed)
  @IsString()
  @Length(1, 200)
  @Matches(/^\P{Cc}*$/u, { message: 'what must not hold control characters' })
  what?: string;

  @ApiPropertyOptional({
    description: 'Not after today in Romania',
    format: 'date',
  })
  @sent()
  @calendarDay()
  @notAfterToday()
  doneOn?: string;

  @ApiPropertyOptional({ maximum: MAX_KM, minimum: 0, type: 'integer' })
  @sent()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometerKm?: number;

  @ApiPropertyOptional({
    description: 'In bani; null clears it',
    maximum: MAX_REPAIR_COST_BANI,
    minimum: 0,
    nullable: true,
    type: 'integer',
  })
  @given()
  @IsInt()
  @Min(0)
  @Max(MAX_REPAIR_COST_BANI)
  costBani?: number | null;
}

export class ClientRepairDriverDto {
  @ApiProperty({
    description: 'First name and initial, or the deleted-account label',
    example: 'Andrei M.',
  })
  shortName!: string;
}

export class ClientRepairCarDto {
  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;
}

// A logged repair a driver shared with the garage it names.
export class ClientRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: ClientRepairDriverDto })
  driver!: ClientRepairDriverDto;

  @ApiProperty({ type: ClientRepairCarDto })
  car!: ClientRepairCarDto;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ nullable: true, type: 'integer' })
  odometerKm!: number | null;

  @ApiProperty({ description: 'In bani', nullable: true, type: 'integer' })
  costBani!: number | null;

  @ApiProperty({
    description: 'Sent back with a correction',
    format: 'date-time',
  })
  version!: string;

  @ApiProperty({
    description: 'When the garage last corrected it, if it was the last writer',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  correctedAt!: string | null;
}

export class ClientRepairListDto {
  @ApiProperty({
    description: 'Newest first, at most 200',
    type: [ClientRepairDto],
  })
  items!: ClientRepairDto[];

  @ApiProperty({ description: 'More repairs exist than the list holds' })
  truncated!: boolean;
}

// A driver's logged repair in the admin's list: the day and the car alone.
export class AdminRepairListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ type: ClientRepairCarDto })
  car!: ClientRepairCarDto;
}

export class AdminRepairListDto {
  @ApiProperty({
    description: 'Newest first, at most 200',
    type: [AdminRepairListItemDto],
  })
  items!: AdminRepairListItemDto[];

  @ApiProperty({ description: 'More repairs exist than the list holds' })
  truncated!: boolean;
}

// A driver's logged repair as the admin opens it, shared with a garage or not.
export class AdminRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: ClientRepairCarDto })
  car!: ClientRepairCarDto;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty({
    description: 'The garage as the driver named it, on MotorFix or not',
  })
  garageName!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ nullable: true, type: 'integer' })
  odometerKm!: number | null;

  @ApiProperty({ description: 'In bani', nullable: true, type: 'integer' })
  costBani!: number | null;

  @ApiProperty({
    description: 'Sent back with a correction',
    format: 'date-time',
  })
  version!: string;

  @ApiProperty({
    description: 'Who last corrected it, as the driver’s history tells it',
    enum: ['garage', 'admin'],
    nullable: true,
    type: String,
  })
  correctedBy!: 'garage' | 'admin' | null;
}
