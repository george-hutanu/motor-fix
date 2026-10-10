import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BrandDto } from './brands.dto';
import {
  GARAGE_BRAND_ANSWERS,
  type GarageBrandAnswer,
} from './garage-search.dto';
import { BUSINESS_KINDS, type BusinessKind } from './listing-sections';
import { NearQueryDto } from './near.dto';

export class HomeQueryDto extends NearQueryDto {
  @ApiProperty({
    description: 'The brand, by its catalogue slug',
    example: 'dacia',
    maxLength: 60,
  })
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  brand!: string;
}

// A garage as Home shows it: on the dial or in a preview row.
export class HomeGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Service Auto Militari' })
  name!: string;

  @ApiProperty({ example: 'service-auto-militari' })
  slug!: string;

  @ApiProperty({
    description:
      "The garage's answer for the brand; unstated when it has not marked it",
    enum: GARAGE_BRAND_ANSWERS,
  })
  stance!: GarageBrandAnswer;

  @ApiProperty({
    description: 'One decimal, 1.0 to 5.0; null until the garage has reviews',
    example: 4.9,
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty({ minimum: 0, type: 'integer' })
  reviewCount!: number;

  @ApiProperty({
    description: 'The hourly labour price it starts from, in whole lei',
    nullable: true,
    type: 'integer',
  })
  labourFromLei!: number | null;

  @ApiProperty({ enum: BUSINESS_KINDS, nullable: true })
  businessKind!: BusinessKind | null;

  @ApiPropertyOptional({
    description:
      "The address's city; never for a mobile mechanic, absent when unknown",
    example: 'București',
  })
  city?: string;

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

export class HomeDto {
  @ApiProperty({ type: BrandDto })
  brand!: BrandDto;

  @ApiProperty({
    description:
      'The best-rated garage that works on the brand in the area; null when none does',
    nullable: true,
    type: HomeGarageDto,
  })
  best!: HomeGarageDto | null;

  @ApiProperty({
    description:
      'Up to three: the two best takers, then the best garage that refuses or never said; with no taker, up to three of those',
    maxItems: 3,
    type: [HomeGarageDto],
  })
  preview!: HomeGarageDto[];

  @ApiProperty({
    description: 'Approved garages, in the area of the place when one is given',
    type: 'integer',
  })
  total!: number;

  @ApiProperty({
    description: 'Approved garages that work on the brand',
    type: 'integer',
  })
  takers!: number;
}

export class PopularBrandsQueryDto {
  @ApiPropertyOptional({ default: 8, maximum: 12, minimum: 1, type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  limit: number = 8;
}
