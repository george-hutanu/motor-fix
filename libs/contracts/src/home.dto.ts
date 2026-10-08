import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatLong,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BrandDto } from './brands.dto';

export class HomeQueryDto {
  @ApiProperty({
    description: 'The brand, by its catalogue slug',
    example: 'dacia',
    maxLength: 60,
  })
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  brand!: string;

  @ApiPropertyOptional({
    description:
      'The place as "lat,lng"; accepted and ignored until a place narrows the count',
    example: '44.43,26.10',
  })
  @IsOptional()
  // IsLatLong alone takes a third number after the second comma.
  @Matches(/^[^,]+,[^,]+$/)
  @IsLatLong()
  near?: string;
}

export class HomeDto {
  @ApiProperty({ type: BrandDto })
  brand!: BrandDto;

  @ApiProperty({ description: 'Approved garages', type: 'integer' })
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
