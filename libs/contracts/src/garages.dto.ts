import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsOptional } from 'class-validator';

import {
  BrandRefDto,
  GarageBrandAnswerDto,
  PublicBrandDto,
} from './garage-brands.dto';
import { CourtesyCarDto, PaymentMethodsDto } from './garage-settings.dto';
import { BUSINESS_KINDS, type BusinessKind } from './listing-sections';

const STANCES = ['works_on', 'does_not_take'] as const;

// The brand a visitor came for, and whether the garage takes it.
export class PublicGarageBrandDto extends BrandRefDto {
  @ApiProperty({
    description: 'does_not_take also when the garage never named the brand',
    enum: STANCES,
  })
  stance!: (typeof STANCES)[number];
}

// Any brand value is accepted: one that names no catalogue brand reads as
// none, so a shared link never fails.
export class PublicGarageQueryDto {
  @ApiPropertyOptional({
    description: "A catalogue brand's slug; anything else reads as none",
    example: 'dacia',
  })
  @IsOptional()
  @Allow()
  brand?: string;
}

// A garage as anyone may read it: only an approved one is ever returned.
// A job the garage lists a price for, which a driver can ask it about.
export class PublicJobTypeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nameRo!: string;

  @ApiProperty()
  nameEn!: string;
}

// A garage photo as anyone may see it: two signed addresses, never its key.
export class PublicGaragePhotoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'The thumbnail copy (400 px), signed for an hour',
    format: 'uri',
  })
  thumbnailUrl!: string;

  @ApiProperty({
    description: 'The display copy (1,600 px), signed for an hour',
    format: 'uri',
  })
  displayUrl!: string;

  @ApiPropertyOptional({ description: 'Upright, when known', minimum: 1 })
  width?: number;

  @ApiPropertyOptional({ description: 'Upright, when known', minimum: 1 })
  height?: number;
}

export class PublicGarageDto extends GarageBrandAnswerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional({ description: 'A workshop only.', maxLength: 200 })
  address?: string;

  @ApiPropertyOptional({ description: 'A workshop only.', format: 'double' })
  latitude?: number;

  @ApiPropertyOptional({ description: 'A workshop only.', format: 'double' })
  longitude?: number;

  @ApiPropertyOptional({
    description: 'A mobile mechanic only: how far from its base it travels.',
    maximum: 100,
    minimum: 1,
  })
  serviceRadiusKm?: number;

  @ApiPropertyOptional({ enum: BUSINESS_KINDS })
  businessKind?: BusinessKind;

  @ApiPropertyOptional({
    description: 'The line the garage wrote about itself, as written',
    maxLength: 160,
  })
  description?: string;

  @ApiProperty({
    description: 'When MotorFix last verified the garage',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  verifiedAt!: string | null;

  @ApiProperty({
    description: 'Out of 5, one decimal; null until reviews exist',
    format: 'double',
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty({ minimum: 0 })
  reviewCount!: number;

  @ApiPropertyOptional({
    description: 'Only when the read named a catalogue brand',
    type: PublicGarageBrandDto,
  })
  brand?: PublicGarageBrandDto;

  @ApiProperty({ type: [PublicBrandDto] })
  declare worksOn: PublicBrandDto[];

  @ApiProperty({ type: PaymentMethodsDto })
  paymentMethods!: PaymentMethodsDto;

  @ApiPropertyOptional({
    description:
      'Absent when the garage does not list one; a price only when paid',
    type: CourtesyCarDto,
  })
  courtesyCar?: CourtesyCarDto;

  @ApiProperty({
    description:
      'The jobs of the visible price list, in its order; empty without one',
    type: [PublicJobTypeDto],
  })
  jobTypes!: PublicJobTypeDto[];

  @ApiProperty({
    description:
      "In the owner's order; empty when no photo is ready to be seen",
    type: [PublicGaragePhotoDto],
  })
  photos!: PublicGaragePhotoDto[];
}
