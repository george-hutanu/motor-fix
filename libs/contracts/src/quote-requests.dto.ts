import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { NearQueryDto } from './near.dto';
import type { Problem } from './problem';
import { REQUEST_SOURCES, type RequestSource } from './request-status';

// The garages one request goes to, the profile's included.
export const REQUEST_MAX_GARAGES = 5;
export const REQUEST_DESCRIPTION_MAX = 1000;
// A request with no job switched on says what is wrong in at least this many.
export const REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS = 10;

export const CANNOT_RECEIVE_REASONS = [
  'brand',
  'fuel',
  'jobs',
  'not_taking_requests',
] as const;
export type CannotReceiveReason = (typeof CANNOT_RECEIVE_REASONS)[number];

// The first garage of a send that cannot take it, and why.
export interface GarageCannotReceiveProblem extends Problem {
  code: 'garage_cannot_receive';
  garageId: string;
  garageName: string;
  reason: CannotReceiveReason;
}

const trimmedOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',') : value;

export class CreateQuoteRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  carId!: string;

  @ApiProperty({
    description: 'The garages, in the order the driver ticked them; at most 5',
    format: 'uuid',
    isArray: true,
    type: String,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  garageIds!: string[];

  @ApiProperty({
    description: 'Where each garage of garageIds was chosen, one for one',
    enum: REQUEST_SOURCES,
    isArray: true,
  })
  @IsArray()
  @IsIn(REQUEST_SOURCES, { each: true })
  sources!: RequestSource[];

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  jobTypeIds!: string[];

  @ApiPropertyOptional({
    description: `Trimmed; required, of at least ${REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS} characters, when no job is chosen`,
    maxLength: REQUEST_DESCRIPTION_MAX,
    nullable: true,
    type: String,
  })
  @Transform(trimmedOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(REQUEST_DESCRIPTION_MAX)
  description?: string | null;
}

export class CandidateGaragesQueryDto extends NearQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  carId!: string;

  @ApiPropertyOptional({
    description: 'The jobs switched on, as comma-separated ids',
    type: String,
  })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  jobTypeIds?: string[];

  @ApiPropertyOptional({
    description: "The profile's garage, already in the request",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  exclude?: string;
}

export class CandidateGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({
    description: 'Kilometres from the place; null for a mobile mechanic',
    format: 'double',
    nullable: true,
    type: Number,
  })
  distanceKm!: number | null;

  @ApiProperty({ description: 'A mobile mechanic, who comes to the driver' })
  comesToYou!: boolean;
}

export class CandidateGarageListDto {
  @ApiProperty({ type: [CandidateGarageDto] })
  items!: CandidateGarageDto[];
}
