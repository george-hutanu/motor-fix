import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

import { CarTransferLineDto } from './car-transfers.dto';
import { todayInBucharest } from './garage-hours';
import { FUELS, MAX_KM, normalisePlate, STORED_PLATE } from './plate';

type Fuel = (typeof FUELS)[number];

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Next year's models are on sale before the year turns.
const notAfterNextYear = () =>
  ValidateBy({
    name: 'notAfterNextYear',
    validator: {
      defaultMessage: () => 'year must not be after next year',
      validate: (value) =>
        typeof value === 'number' && value <= new Date().getFullYear() + 1,
    },
  });

// YYYY-MM-DD naming a day the calendar has: no year 0, which Date takes for
// 1 BC and the database cannot store.
export const calendarDay = () =>
  ValidateBy({
    name: 'calendarDay',
    validator: {
      defaultMessage: (args) => `${args?.property} must be a YYYY-MM-DD day`,
      // Month 13 or day 00 make no Date at all; 30 February makes 2 March.
      validate: (value) => {
        if (
          typeof value !== 'string' ||
          !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
        ) {
          return false;
        }
        const day = new Date(`${value}T00:00:00Z`);
        return (
          !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value)
        );
      },
    },
  });

// A day not after today as Bucharest reads it.
export const notAfterToday = () =>
  ValidateBy({
    name: 'notAfterToday',
    validator: {
      defaultMessage: (args) =>
        `${args?.property} must not be after today in Bucharest`,
      validate: (value) =>
        typeof value === 'string' && value <= todayInBucharest(),
    },
  });

export class CreateCarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  brandId!: string;

  @ApiProperty({ description: 'Trimmed', maxLength: 40, minLength: 1 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 40)
  @Matches(/^\P{Cc}*$/u, { message: 'model must not hold control characters' })
  model!: string;

  @ApiProperty({
    description: 'From 1950 to next year',
    minimum: 1950,
    type: 'integer',
  })
  @IsInt()
  @Min(1950)
  @notAfterNextYear()
  year!: number;

  @ApiProperty({ maximum: MAX_KM, minimum: 0, type: 'integer' })
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometerKm!: number;

  @ApiProperty({ enum: FUELS })
  @IsIn(FUELS)
  fuel!: Fuel;

  @ApiPropertyOptional({ description: 'Trimmed', maxLength: 30 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(30)
  @Matches(/^\P{Cc}*$/u, { message: 'engine must not hold control characters' })
  engine?: string;

  @ApiPropertyOptional({
    description: 'Stored in upper case without spaces or hyphens',
    example: 'B123ABC',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalisePlate(value) : value,
  )
  @Matches(STORED_PLATE)
  plate?: string;

  @ApiPropertyOptional({
    description: 'At most five years ahead',
    format: 'date',
  })
  @IsOptional()
  @calendarDay()
  itpUntil?: string;

  @ApiPropertyOptional({
    description: 'At most five years ahead',
    format: 'date',
  })
  @IsOptional()
  @calendarDay()
  rcaUntil?: string;

  @ApiPropertyOptional({
    description: 'At most five years ahead',
    format: 'date',
  })
  @IsOptional()
  @calendarDay()
  rovinietaUntil?: string;

  @ApiPropertyOptional({
    description:
      'The odometer reading the next oil service is due at: above odometerKm and at most 100,000 km past it',
    maximum: MAX_KM,
    minimum: 1,
    nullable: true,
    type: 'integer',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  nextServiceKm?: number | null;
}

// Sent: checked as the add dialog checks it. A field left out keeps its value.
const sent = () => ValidateIf((_, value) => value !== undefined);
// Sent and not null: null clears an optional field.
const given = () =>
  ValidateIf((_, value) => value !== undefined && value !== null);

// An edit carries only the fields it changes, and the version it read.
export class UpdateCarDto {
  @ApiProperty({
    description: 'The updatedAt of the car as read; an older one is refused',
    format: 'date-time',
  })
  @IsISO8601()
  version!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @sent()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Trimmed', maxLength: 40, minLength: 1 })
  @sent()
  @Transform(trimmed)
  @IsString()
  @Length(1, 40)
  @Matches(/^\P{Cc}*$/u, { message: 'model must not hold control characters' })
  model?: string;

  @ApiPropertyOptional({
    description: 'From 1950 to next year',
    minimum: 1950,
    type: 'integer',
  })
  @sent()
  @IsInt()
  @Min(1950)
  @notAfterNextYear()
  year?: number;

  @ApiPropertyOptional({ maximum: MAX_KM, minimum: 0, type: 'integer' })
  @sent()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometerKm?: number;

  @ApiPropertyOptional({ enum: FUELS })
  @sent()
  @IsIn(FUELS)
  fuel?: Fuel;

  @ApiPropertyOptional({
    description: 'Trimmed; null or blank clears it',
    maxLength: 30,
    nullable: true,
    type: String,
  })
  @given()
  @Transform(trimmed)
  @IsString()
  @MaxLength(30)
  @Matches(/^\P{Cc}*$/u, { message: 'engine must not hold control characters' })
  engine?: string | null;

  @ApiPropertyOptional({
    description:
      'Stored in upper case without spaces or hyphens; null clears it',
    example: 'B123ABC',
    nullable: true,
    type: String,
  })
  @given()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalisePlate(value) : value,
  )
  @Matches(STORED_PLATE)
  plate?: string | null;

  @ApiPropertyOptional({
    description: 'At most five years ahead; null clears it',
    format: 'date',
    nullable: true,
    type: String,
  })
  @given()
  @calendarDay()
  itpUntil?: string | null;

  @ApiPropertyOptional({
    description: 'At most five years ahead; null clears it',
    format: 'date',
    nullable: true,
    type: String,
  })
  @given()
  @calendarDay()
  rcaUntil?: string | null;

  @ApiPropertyOptional({
    description: 'At most five years ahead; null clears it',
    format: 'date',
    nullable: true,
    type: String,
  })
  @given()
  @calendarDay()
  rovinietaUntil?: string | null;

  @ApiPropertyOptional({
    description:
      'Above the odometer and at most 100,000 km past it; null clears it',
    maximum: MAX_KM,
    minimum: 1,
    nullable: true,
    type: 'integer',
  })
  @given()
  @IsInt()
  @Min(1)
  nextServiceKm?: number | null;
}

// The car as its owner sees it; nobody else is ever answered with it.
export class CarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  brandId!: string;

  @ApiProperty({ example: 'BMW' })
  brandName!: string;

  @ApiProperty({ example: '320d' })
  model!: string;

  @ApiProperty({ type: 'integer' })
  year!: number;

  @ApiProperty({ enum: FUELS })
  fuel!: Fuel;

  @ApiProperty({ nullable: true, type: String })
  engine!: string | null;

  @ApiProperty({ type: 'integer' })
  odometerKm!: number;

  @ApiProperty({
    description: 'The odometer reading the next oil service is due at',
    nullable: true,
    type: 'integer',
  })
  nextServiceKm!: number | null;

  @ApiProperty({
    description:
      "The estimated day of the next oil service at the car's average mileage; null without nextServiceKm or once it is reached",
    format: 'date',
    nullable: true,
    type: String,
  })
  serviceDueOn!: string | null;

  @ApiProperty({ example: 'B123ABC', nullable: true, type: String })
  plate!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  itpUntil!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  rcaUntil!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  rovinietaUntil!: string | null;

  @ApiProperty({
    description: "The car's sent transfer while within its time",
    nullable: true,
    type: CarTransferLineDto,
  })
  transfer!: CarTransferLineDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    description: 'The version an edit sends back',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class CarListDto {
  @ApiProperty({ description: 'Newest first', type: [CarDto] })
  items!: CarDto[];
}

const DUE_KINDS = ['itp', 'oil'] as const;
const DUE_STATES = ['red', 'amber', 'green', 'grey'] as const;

// One thing coming up for one of the driver's cars.
export class DueItemDto {
  @ApiProperty({ enum: DUE_KINDS })
  kind!: (typeof DUE_KINDS)[number];

  @ApiProperty({ format: 'uuid' })
  carId!: string;

  @ApiProperty({ description: 'Brand and model', example: 'BMW 320d' })
  carName!: string;

  @ApiProperty({
    description:
      "The ITP date, or the oil service's estimated day; null when there is none",
    example: '2026-11-13',
    format: 'date',
    nullable: true,
    type: String,
  })
  dueOn!: string | null;

  @ApiProperty({
    description:
      'Whole days in Europe/Bucharest from today to dueOn, negative when passed',
    example: 36,
    nullable: true,
    type: 'integer',
  })
  daysLeft!: number | null;

  @ApiProperty({
    description:
      "The date is behind, or the oil service's kilometres are reached",
  })
  passed!: boolean;

  @ApiProperty({
    description: 'The oil service only: the kilometres it is due at',
    example: 152000,
    nullable: true,
    type: 'integer',
  })
  dueKm!: number | null;

  @ApiProperty({
    description: 'The oil service only: kilometres left, negative when over',
    example: 3800,
    nullable: true,
    type: 'integer',
  })
  kmLeft!: number | null;

  @ApiProperty({
    description:
      'red at 7 days or fewer or passed, amber to 60, green beyond, grey without a date',
    enum: DUE_STATES,
  })
  state!: (typeof DUE_STATES)[number];
}

export class DueItemsDto {
  @ApiProperty({
    description: 'Passed first, then soonest; undated last',
    type: [DueItemDto],
  })
  items!: DueItemDto[];

  @ApiProperty({
    description: "The driver's active cars",
    example: 2,
    type: 'integer',
  })
  carCount!: number;

  @ApiProperty({
    description: 'The items whose state is red or amber',
    example: 1,
    type: 'integer',
  })
  dueSoonCount!: number;
}
