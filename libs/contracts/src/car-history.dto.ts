import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { calendarDay } from './cars.dto';
import { MAX_KM } from './plate';

export class CarRepairCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty({ type: 'integer' })
  year!: number;
}

export class RepairReviewDto {
  @ApiProperty({
    description:
      'write: the driver may still review; rated: a review stands; none: neither',
    enum: ['write', 'rated', 'none'],
  })
  state!: 'write' | 'rated' | 'none';

  @ApiPropertyOptional({
    description: 'Only with rated',
    maximum: 5,
    minimum: 1,
    type: 'integer',
  })
  rating?: number;
}

export class CarRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty()
  garageName!: string;

  @ApiProperty({
    description: 'The garage on MotorFix',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  garageId!: string | null;

  @ApiProperty({ type: CarRepairCarDto })
  car!: CarRepairCarDto;

  @ApiProperty({
    description: "A MotorFix repair's mechanic, as the job names them",
    nullable: true,
    type: String,
  })
  mechanicName!: string | null;

  @ApiProperty({
    description:
      'Null on every row until the review drawer ships and fills it for a MotorFix repair',
    nullable: true,
    type: RepairReviewDto,
  })
  review!: RepairReviewDto | null;

  @ApiProperty({ enum: ['motorfix', 'logged'] })
  source!: 'motorfix' | 'logged';

  @ApiProperty({
    description: 'Created before the reader held the car: it came with it',
  })
  fromPreviousOwner!: boolean;

  @ApiProperty({ nullable: true, type: 'integer' })
  odometerKm!: number | null;

  @ApiProperty({ description: 'In bani', nullable: true, type: 'integer' })
  costBani!: number | null;

  @ApiProperty({
    description:
      'Who last corrected it: the garage it names or an admin; none for the driver',
    enum: ['garage', 'admin'],
    nullable: true,
    type: String,
  })
  correctedBy!: 'garage' | 'admin' | null;
}

export class CarRepairListDto {
  @ApiProperty({ description: 'Newest first', type: [CarRepairDto] })
  items!: CarRepairDto[];
}

export class RepairsQueryDto {
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    default: 20,
    description: 'Repairs per page',
    maximum: 20,
    minimum: 1,
    type: 'integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @ApiPropertyOptional({
    description: 'One of the caller’s cars',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  carId?: string;
}

export class RepairListDto {
  @ApiProperty({
    description: 'Newest first, across the caller’s cars',
    type: [CarRepairDto],
  })
  items!: CarRepairDto[];

  @ApiProperty({
    description: 'Pass as cursor for the next page; null on the last',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}

export class SoldCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ format: 'date' })
  saleDate!: string;
}

export class SoldCarListDto {
  @ApiProperty({ description: 'Newest sale first', type: [SoldCarDto] })
  items!: SoldCarDto[];
}

// The largest amount a driver may log: 1 000 000 lei.
const MAX_LOGGED_COST_BANI = 100_000_000;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Sent: checked, null included; left out: not read.
const sent = () => ValidateIf((_, value) => value !== undefined);

// No control character and no lone surrogate, which PostgreSQL cannot store.
const NO_CONTROL = /^[^\p{Cc}\p{Cs}]*$/u;

// A repair the driver had done anywhere, logged on one of their cars.
export class LogRepairDto {
  @ApiProperty({ description: 'Trimmed', maxLength: 120, minLength: 3 })
  @Transform(trimmed)
  @IsString()
  @Length(3, 120)
  @Matches(NO_CONTROL, { message: 'what must not hold control characters' })
  what!: string;

  @ApiPropertyOptional({
    description:
      'Trimmed; required without garageId, ignored for the stored name with one',
    maxLength: 80,
    minLength: 2,
  })
  @ValidateIf((o) => o.garageId === undefined || o.garageName !== undefined)
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  @Matches(NO_CONTROL, {
    message: 'garageName must not hold control characters',
  })
  garageName?: string;

  @ApiPropertyOptional({
    description: 'An approved garage on MotorFix, picked from the list',
    format: 'uuid',
  })
  @sent()
  @IsUUID()
  garageId?: string;

  @ApiProperty({ format: 'date' })
  @calendarDay()
  doneOn!: string;

  @ApiProperty({ maximum: MAX_KM, minimum: 0, type: 'integer' })
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometerKm!: number;

  @ApiPropertyOptional({
    description: 'In bani',
    maximum: MAX_LOGGED_COST_BANI,
    minimum: 0,
    nullable: true,
    type: 'integer',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_LOGGED_COST_BANI)
  costBani?: number | null;

  @ApiPropertyOptional({
    description:
      'True once the driver confirmed a future date or a lower odometer',
  })
  @sent()
  @IsBoolean()
  confirm?: boolean;
}
