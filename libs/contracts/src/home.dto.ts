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

export class HomeDto {
  @ApiProperty({ type: BrandDto })
  brand!: BrandDto;

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
