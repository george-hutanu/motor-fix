import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Why drivers do not see a job, in the order the first that applies wins.
export const PRICE_LIST_REASONS = [
  'rejected',
  'awaiting_approval',
  'not_authorised',
  'hidden_by_garage',
  'no_top_price',
] as const;
export type PriceListReason = (typeof PRICE_LIST_REASONS)[number];

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
}

export class PriceListDto {
  @ApiProperty({
    description:
      "Every job of the garage's price list, once, in the list's order; empty without one",
    type: [PriceListItemDto],
  })
  items!: PriceListItemDto[];
}
