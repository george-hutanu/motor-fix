import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsOptional } from 'class-validator';

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
