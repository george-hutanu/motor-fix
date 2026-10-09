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
import {
  type CannotReceiveReason,
  REQUEST_DESCRIPTION_MAX,
  REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS,
  REQUEST_SOURCES,
  type RequestSource,
} from './request-status';

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

// Ids compare in lower case, so one id given twice in another case is a repeat.
const lowerIds = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((id) => (typeof id === 'string' ? id.toLowerCase() : id))
    : value;

const commaList = ({ value }: { value: unknown }) =>
  lowerIds({ value: typeof value === 'string' ? value.split(',') : value });

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
  @Transform(lowerIds)
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
  @Transform(lowerIds)
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
