import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';

import { normalisePlate } from './plate';

export const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'] as const;
export type Fuel = (typeof FUELS)[number];

export const MAX_KM = 2_000_000;

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

// YYYY-MM-DD naming a day the calendar has.
const calendarDay = () =>
  ValidateBy({
    name: 'calendarDay',
    validator: {
      defaultMessage: (args) => `${args?.property} must be a YYYY-MM-DD day`,
      validate: (value) =>
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
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
  @Matches(/^[A-Z0-9]{2,12}$/)
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

  @ApiProperty({ example: 'B123ABC', nullable: true, type: String })
  plate!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  itpUntil!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  rcaUntil!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  rovinietaUntil!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CarListDto {
  @ApiProperty({ description: 'Newest first', type: [CarDto] })
  items!: CarDto[];
}
