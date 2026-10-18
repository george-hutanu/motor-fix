import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsDefined, IsISO8601, IsOptional } from 'class-validator';

import { PublicLabourDto } from './garages.dto';
import { FieldProblemDto } from './listing-check/listing-check.dto';

// Why drivers do not see a job, in the order the first that applies wins.
export const PRICE_LIST_REASONS = [
  'rejected',
  'awaiting_approval',
  'not_authorised',
  'hidden_by_garage',
  'no_top_price',
] as const;
export type PriceListReason = (typeof PRICE_LIST_REASONS)[number];

// A job's own range for one catalogue brand, listed with the brand's name.
export class BrandRangeItemDto {
  @ApiProperty({ format: 'uuid' })
  brandId!: string;

  @ApiProperty({ example: 'BMW' })
  name!: string;

  @ApiProperty({ type: 'integer' })
  fromBani!: number;

  @ApiPropertyOptional({ description: 'Absent when not set', type: 'integer' })
  toBani?: number;
}

export class PriceListItemDto {
  @ApiProperty({ format: 'uuid' })
  jobTypeId!: string;

  @ApiProperty({ example: 'Verificare suspensie și geometrie' })
  nameRo!: string;

  @ApiProperty({ example: 'Suspension and alignment check' })
  nameEn!: string;

  @ApiProperty({ description: 'Drivers see the job on the garage profile' })
  public!: boolean;

  @ApiPropertyOptional({
    description:
      'Only when the job is not public: the first that applies, in this order',
    enum: PRICE_LIST_REASONS,
  })
  reason?: PriceListReason;

  @ApiPropertyOptional({
    description:
      "The default row's id, what a range change names; absent without one",
    format: 'uuid',
  })
  priceId?: string;

  @ApiPropertyOptional({
    description:
      'When the default row last changed, sent back with a range change',
    format: 'date-time',
  })
  updatedAt?: string;

  @ApiPropertyOptional({ minimum: 1, type: 'integer' })
  durationMinutes?: number;

  @ApiPropertyOptional({
    description:
      "The default range's starting price; absent only when the job has no default range",
    type: 'integer',
  })
  fromBani?: number;

  @ApiPropertyOptional({
    description: "The default range's top price, when set",
    type: 'integer',
  })
  toBani?: number;

  @ApiProperty({
    description:
      "The job's brand ranges, by the brand's popularity rank, then name; empty without one",
    type: [BrandRangeItemDto],
  })
  brandRanges!: BrandRangeItemDto[];
}

export class PriceListDto {
  @ApiProperty({
    description:
      "Every job of the garage's price list, once, in the list's order; empty without one",
    type: [PriceListItemDto],
  })
  items!: PriceListItemDto[];

  @ApiPropertyOptional({
    description:
      "The garage's hourly labour range, as the profile gives it; absent when either end is unset",
    type: PublicLabourDto,
  })
  labour?: PublicLabourDto;
}

// Both ends are judged by the one range check, so a wrong value is a field
// error rather than a bare 400.
export class BrandRangeDto {
  @ApiPropertyOptional({ example: 110_000, type: 'integer' })
  @IsOptional()
  @Allow()
  fromBani?: unknown;

  @ApiPropertyOptional({ example: 170_000, type: 'integer' })
  @IsOptional()
  @Allow()
  toBani?: unknown;
}

export class BrandRangeSavedDto {
  @ApiProperty({ format: 'uuid' })
  jobTypeId!: string;

  @ApiProperty({ format: 'uuid' })
  brandId!: string;

  @ApiProperty({ type: 'integer' })
  fromBani!: number;

  @ApiProperty({ type: 'integer' })
  toBani!: number;

  @ApiProperty({
    description: 'Notes that do not stop the range from being saved',
    type: [FieldProblemDto],
  })
  warnings!: FieldProblemDto[];
}

// A job's default range as the owner changes it in place. Every value is left
// to the one range check, so a wrong one is a field error rather than a bare
// 400; null clears the top or the duration, and an omitted one is required.
export class PriceRangeDto {
  @ApiPropertyOptional({ example: 95_000, type: 'integer' })
  @IsOptional()
  @Allow()
  fromBani?: unknown;

  @ApiPropertyOptional({
    description: 'null clears the top',
    example: 145_000,
    nullable: true,
    type: 'integer',
  })
  @IsOptional()
  @Allow()
  toBani?: unknown;

  @ApiPropertyOptional({
    description: 'Minutes in steps of 15; null clears the duration',
    example: 120,
    nullable: true,
    type: 'integer',
  })
  @IsOptional()
  @Allow()
  durationMinutes?: unknown;

  @ApiProperty({
    description:
      "The row's updatedAt as the owner read it; a newer save answers 409 stale",
    format: 'date-time',
  })
  @IsDefined()
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

export class PriceRangeSavedDto {
  @ApiProperty({ format: 'uuid' })
  priceId!: string;

  @ApiProperty({ format: 'uuid' })
  jobTypeId!: string;

  @ApiProperty({ type: 'integer' })
  fromBani!: number;

  @ApiPropertyOptional({ description: 'Absent when not set', type: 'integer' })
  toBani?: number;

  @ApiPropertyOptional({ description: 'Absent when not set', type: 'integer' })
  durationMinutes?: number;

  @ApiProperty({
    description: 'The stamp the next write of this row sends back',
    format: 'date-time',
  })
  updatedAt!: string;

  @ApiProperty({
    description: 'Notes that do not stop the range from being saved',
    type: [FieldProblemDto],
  })
  warnings!: FieldProblemDto[];
}

// The garage's hourly labour range: both ends or nothing, judged by the one
// range check.
export class LabourRangeDto {
  @ApiPropertyOptional({ example: 20_000, type: 'integer' })
  @IsOptional()
  @Allow()
  fromBani?: unknown;

  @ApiPropertyOptional({ example: 26_000, type: 'integer' })
  @IsOptional()
  @Allow()
  toBani?: unknown;
}

export class LabourRangeSavedDto {
  @ApiProperty({ type: 'integer' })
  fromBani!: number;

  @ApiProperty({ type: 'integer' })
  toBani!: number;

  @ApiProperty({
    description: 'Notes that do not stop the range from being saved',
    type: [FieldProblemDto],
  })
  warnings!: FieldProblemDto[];
}
