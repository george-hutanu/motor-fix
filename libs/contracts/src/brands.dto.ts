import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
} from 'class-validator';

import { type VisibleTextRule, visibleTextProblem } from './visible-text';

export class BrandsQueryDto {
  @ApiPropertyOptional({
    description: 'Part of a brand name; accents and case are ignored',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class BrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Škoda' })
  name!: string;

  @ApiProperty({ example: 'skoda' })
  slug!: string;

  @ApiProperty({
    description: '1 is the most popular; null is unranked',
    nullable: true,
    type: 'integer',
  })
  popularity!: number | null;

  @ApiPropertyOptional({
    description:
      'Romanian "your" form of the name, its hyphen U+2011; null or absent reads as the name',
    example: 'BMW\u2011ul tău',
    nullable: true,
    type: String,
  })
  roPossessive?: string | null;
}

export class BrandPageDto {
  @ApiProperty({
    description: 'By popularity, unranked last, then by name; 20 at most',
    type: [BrandDto],
  })
  items!: BrandDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Brands matching the search' })
  total!: number;
}

// A brand's name as an admin types it: 2 to 40 characters that show, the
// bound the brand file's names keep too.
export const BRAND_NAME: VisibleTextRule = { max: 40, min: 2 };

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const BrandName = () =>
  ValidateBy({
    name: 'brandName',
    validator: {
      defaultMessage: (args) =>
        `${args?.property} must hold ${BRAND_NAME.min} to ${BRAND_NAME.max} visible characters and no control characters`,
      validate: (value) =>
        typeof value === 'string' &&
        visibleTextProblem(value, BRAND_NAME) === null,
    },
  });

// One brand as the admin list shows it: its state, how many garages work on
// it and how many drivers' cars are of it, and the value an edit sends back.
export class AdminBrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Škoda' })
  name!: string;

  @ApiProperty({ example: 'skoda' })
  slug!: string;

  @ApiProperty({ enum: ['active', 'retired'] })
  state!: 'active' | 'retired';

  @ApiProperty({ description: 'Garages that work on it.', example: 12 })
  garages!: number;

  @ApiProperty({ description: 'Drivers’ cars of this brand.', example: 40 })
  cars!: number;

  @ApiProperty({
    description: 'Sent back as seenUpdatedAt on an edit.',
    format: 'date-time',
  })
  updatedAt!: string;

  @ApiProperty({
    description:
      'The admin who last changed it; null when only the loader did.',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  updatedBy!: string | null;
}

export class AdminBrandListDto {
  @ApiProperty({ type: [AdminBrandDto] })
  items!: AdminBrandDto[];
}

export class AdminBrandsQueryDto {
  @ApiPropertyOptional({
    description: 'Part of the name, accents and case ignored.',
    maxLength: BRAND_NAME.max,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BRAND_NAME.max)
  q?: string;
}

export class CreateBrandDto {
  @ApiProperty({ example: 'Xpeng', maxLength: BRAND_NAME.max, minLength: 2 })
  @Transform(trimmed)
  @BrandName()
  name!: string;
}

export class UpdateBrandDto {
  @ApiPropertyOptional({ example: 'Mercedes-Benz', maxLength: BRAND_NAME.max })
  @IsOptional()
  @Transform(trimmed)
  @BrandName()
  name?: string;

  @ApiPropertyOptional({
    description: 'false retires it, true brings it back.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({
    description: 'The updatedAt the admin saw.',
    format: 'date-time',
  })
  @IsISO8601({ strict: true })
  seenUpdatedAt!: string;
}
