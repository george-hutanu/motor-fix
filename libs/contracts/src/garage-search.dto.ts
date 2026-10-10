import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { GarageBrandAnswerDto } from './garage-brands.dto';
import { NearQueryDto } from './near.dto';

export const GARAGE_BRAND_ANSWERS = [
  'works_on',
  'does_not_take',
  'unstated',
] as const;
export type GarageBrandAnswer = (typeof GARAGE_BRAND_ANSWERS)[number];

export class GarageSearchQueryDto extends NearQueryDto {
  @ApiProperty({
    description: 'The brand, by its catalogue id',
    format: 'uuid',
  })
  @IsUUID()
  brandId!: string;

  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page; opaque',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class ListedGarageDto extends GarageBrandAnswerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Service Auto Nord' })
  name!: string;

  @ApiProperty({ example: 'service-auto-nord' })
  slug!: string;

  @ApiProperty({
    description:
      "The garage's answer for the brand; unstated when it has not marked it",
    enum: GARAGE_BRAND_ANSWERS,
  })
  stance!: GarageBrandAnswer;

  @ApiPropertyOptional({
    description:
      'Km from the place, one decimal; null for a mobile mechanic. Only with near',
    nullable: true,
    type: Number,
  })
  distanceKm?: number | null;

  @ApiPropertyOptional({
    description:
      'True for a mobile mechanic whose area holds the place. Only with near',
  })
  comesToYou?: boolean;
}

export class BrandCountsDto {
  @ApiProperty({
    description:
      'Approved garages that work on the brand, over everything found',
    type: 'integer',
  })
  worksOn!: number;

  @ApiProperty({
    description:
      'Approved garages that refuse the brand or have not marked it, over everything found',
    type: 'integer',
  })
  doesNotTake!: number;
}

export class GarageSearchPageDto {
  @ApiProperty({
    description:
      'Garages that work on the brand first, then the rest; inside a group by name, then id; 20 at most',
    type: [ListedGarageDto],
  })
  items!: ListedGarageDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({
    description: 'Every approved garage: worksOn + doesNotTake',
    type: 'integer',
  })
  total!: number;

  @ApiProperty({ type: BrandCountsDto })
  counts!: BrandCountsDto;
}
