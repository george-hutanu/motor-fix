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
}

// A garage's whole brand answer: a brand left out is not stated.
export class ReplaceGarageBrandsDto {
  @ApiProperty({
    description: 'Every marked brand once; a brand left out is switched off',
    type: [GarageBrandStanceDto],
  })
  @IsArray()
  @ArrayUnique((b: GarageBrandStanceDto) => b?.brandId, {
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
