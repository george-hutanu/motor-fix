import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

import { BUSINESS_KINDS, type BusinessKind } from './listing-sections';
import { NearQueryDto } from './near.dto';

export class SaveGarageDto {
  @ApiPropertyOptional({
    description:
      'An undo: the time the garage was first saved, never in the future',
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  savedAt?: string;
}

export class SavedGarageDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ description: 'UTC', format: 'date-time' })
  savedAt!: string;
}

export class SavedGarageIdsDto {
  @ApiProperty({
    description: 'In no promised order',
    format: 'uuid',
    type: [String],
  })
  ids!: string[];
}

export class SavedGaragesQueryDto extends NearQueryDto {
  @ApiPropertyOptional({
    description: 'The nextCursor of the page before; opaque',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class SavedGarageBrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BMW' })
  name!: string;
}

export class SavedGarageItemDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({
    description: 'Out of 5, one decimal; null until reviewed',
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty()
  reviewCount!: number;

  @ApiProperty({ description: 'False unless the garage is approved' })
  available!: boolean;

  @ApiProperty({ enum: BUSINESS_KINDS, nullable: true })
  businessKind!: BusinessKind | null;

  @ApiProperty({ description: 'UTC', format: 'date-time' })
  savedAt!: string;

  @ApiProperty({
    description:
      "Brands of the driver's cars the garage works on with that car's fuel, newest car first",
    type: [SavedGarageBrandDto],
  })
  brands!: SavedGarageBrandDto[];

  @ApiPropertyOptional({
    description:
      'Km from the place, one decimal; null for a mobile mechanic or a garage with no position. Only with near',
    nullable: true,
    type: Number,
  })
  distanceKm?: number | null;

  @ApiPropertyOptional({
    description:
      'For a mobile mechanic only: whether its area holds the place. Only with near',
  })
  comesToYou?: boolean;
}

export class SavedGaragesPageDto {
  @ApiProperty({
    description: 'Newest saved first, then by garage id; 20 at most',
    type: [SavedGarageItemDto],
  })
  items!: SavedGarageItemDto[];

  @ApiProperty({
    description: 'The cursor of the next page; null on the last',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Every saved garage, not the page' })
  total!: number;

  @ApiProperty({
    description: "Saved garages that work on at least one of the driver's cars",
  })
  workingCount!: number;
}
