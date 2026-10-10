import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { FUELS, type Fuel, NOTE_MAX, PHRASE_MAX } from './marked-brands';
import { JOBS_MAX } from './price-range';

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
  // Left out is unchanged; null is not a list and is refused.
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsIn(FUELS, { each: true })
  @ArrayUnique()
  fuels?: Fuel[];

  @ApiPropertyOptional({
    description:
      'A taken brand only: the jobs of the price list it is ticked for. Left out: unchanged, or every job for a brand taken now; empty: none',
    format: 'uuid',
    isArray: true,
    maxItems: JOBS_MAX,
    type: String,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(JOBS_MAX)
  @IsUUID(undefined, { each: true })
  // A uuid in capitals is the same job.
  @ArrayUnique((id: unknown) => String(id).toLowerCase())
  jobs?: string[];
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
    maxLength: NOTE_MAX,
  })
  @Transform(text)
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  brandNote?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; blank or left out is no phrase',
    maxLength: PHRASE_MAX,
  })
  @Transform(text)
  @IsOptional()
  @IsString()
  @MaxLength(PHRASE_MAX)
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

// A taken brand in the owner's answer, with the jobs ticked for it.
export class OwnerBrandDto extends BrandRefDto {
  @ApiProperty({
    description: 'Ticked job type ids, in price-list order',
    format: 'uuid',
    isArray: true,
    type: String,
  })
  jobs!: string[];
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

// The answer the owner's write returns: each taken brand with its jobs.
export class GarageBrandOwnerAnswerDto extends GarageBrandAnswerDto {
  @ApiProperty({ type: [OwnerBrandDto] })
  declare worksOn: OwnerBrandDto[];
}
