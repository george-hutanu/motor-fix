import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { FUELS, type Fuel } from './marked-brands';

const STANCES = ['works_on', 'does_not_take'] as const;
type GarageBrandStance = (typeof STANCES)[number];

// Trimmed; a blank text is no text.
const text = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class GarageBrandStanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  brandId!: string;

  @ApiProperty({ enum: STANCES })
  @IsIn(STANCES)
  stance!: GarageBrandStance;

  @ApiPropertyOptional({
    description:
      'A taken brand only. Left out: unchanged, or all four for a brand taken now; empty: none',
    enum: FUELS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(FUELS, { each: true })
  @ArrayUnique()
  fuels?: Fuel[];
}

// A garage's whole brand answer: a brand left out is not stated.
export class ReplaceGarageBrandsDto {
  @ApiProperty({
    description: 'Every marked brand once; a brand left out is switched off',
    type: [GarageBrandStanceDto],
  })
  @IsArray()
  // A uuid in capitals is the same brand.
  @ArrayUnique((b: GarageBrandStanceDto) => String(b?.brandId).toLowerCase(), {
    message: 'brands must name each brand once',
  })
  @ValidateNested({ each: true })
  @Type(() => GarageBrandStanceDto)
  brands!: GarageBrandStanceDto[];

  @ApiPropertyOptional({
    description: 'Trimmed; blank or left out is no note',
    maxLength: 140,
  })
  @Transform(text)
  @IsOptional()
  @IsString()
  @MaxLength(140)
  brandNote?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; blank or left out is no phrase',
    maxLength: 60,
  })
  @Transform(text)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  refusalPhrase?: string;
}

export class BrandRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BMW' })
  name!: string;

  @ApiProperty({ example: 'bmw' })
  slug!: string;
}

// A taken brand on the garage's public page, with the fuels it works on.
export class PublicBrandDto extends BrandRefDto {
  @ApiProperty({ enum: FUELS, isArray: true })
  fuels!: Fuel[];
}

// The stored answer, in catalogue order: most popular first, unranked last,
// then by name.
export class GarageBrandAnswerDto {
  @ApiProperty({ type: [BrandRefDto] })
  worksOn!: BrandRefDto[];

  @ApiProperty({ type: [BrandRefDto] })
  doesNotTake!: BrandRefDto[];

  @ApiProperty({ nullable: true, type: String })
  brandNote!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refusalPhrase!: string | null;
}
