import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ADDRESS_MAX, PLACE_SEARCH_MIN } from './place-section';

const LANGUAGES = ['ro', 'en'] as const;

export class PlacesQueryDto {
  @ApiProperty({
    description: 'What the owner typed, trimmed',
    maxLength: ADDRESS_MAX,
    minLength: PLACE_SEARCH_MIN,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(PLACE_SEARCH_MIN)
  @MaxLength(ADDRESS_MAX)
  q!: string;

  @ApiPropertyOptional({ default: 'ro', enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  lang?: (typeof LANGUAGES)[number];
}

export class PlaceSuggestionDto {
  @ApiProperty({ example: 'Strada Ștefan cel Mare 12, Sector 2, București' })
  label!: string;

  @ApiProperty({ example: 44.4512 })
  lat!: number;

  @ApiProperty({ example: 26.1207 })
  lng!: number;
}

export class PlacesResultDto {
  @ApiProperty({
    description: 'At most five places, all in Romania',
    type: [PlaceSuggestionDto],
  })
  items!: PlaceSuggestionDto[];
}
