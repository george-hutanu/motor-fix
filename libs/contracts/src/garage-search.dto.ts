import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  isUUID,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';

import { BrandRefDto, GarageBrandAnswerDto } from './garage-brands.dto';
import { FACILITIES, type Facility } from './garage-hours';
import { BUSINESS_KINDS, type BusinessKind } from './listing-sections';
import { NearQueryDto } from './near.dto';
import { inRomania } from './place-section';
import {
  bboxSideKm,
  parseBbox,
  SEARCH_BBOX_MAX_KM,
  SEARCH_IDS_MAX,
  SEARCH_PINS_MAX,
  SEARCH_RADII,
  type SearchRadius,
} from './search-place';

// Up to one page of different garage ids, comma-separated; a repeated key
// arrives as a list and is refused.
export const IsGarageIdList = (field: string) =>
  ValidateBy({
    name: 'garageIds',
    validator: {
      defaultMessage: () =>
        `${field} must be up to ${SEARCH_IDS_MAX} different uuids, comma-separated`,
      validate: (value: unknown) => {
        if (typeof value !== 'string') return false;
        const list = value.split(',');
        return (
          list.length <= SEARCH_IDS_MAX &&
          new Set(list.map((id) => id.toLowerCase())).size === list.length &&
          list.every((id) => isUUID(id))
        );
      },
    },
  });

export const GARAGE_BRAND_ANSWERS = [
  'works_on',
  'does_not_take',
  'unstated',
] as const;
export type GarageBrandAnswer = (typeof GARAGE_BRAND_ANSWERS)[number];

// A box of the visible map, south,west,north,east, wholly inside Romania and
// no wider or taller than the map may ask about.
const IsSearchBbox = () =>
  ValidateBy({
    name: 'searchBbox',
    validator: {
      defaultMessage: () =>
        `bbox must be south,west,north,east inside Romania, at most ${SEARCH_BBOX_MAX_KM} km wide`,
      validate: (value: unknown) => {
        const box = typeof value === 'string' ? parseBbox(value) : undefined;
        return (
          box !== undefined &&
          box.south < box.north &&
          box.west < box.east &&
          inRomania(box.south, box.west) &&
          inRomania(box.north, box.east) &&
          bboxSideKm(box) <= SEARCH_BBOX_MAX_KM
        );
      },
    },
  });

// What both the list and the map pins of a search read.
export class GaragePinsQueryDto extends NearQueryDto {
  @ApiPropertyOptional({
    description:
      'The brand, by its catalogue slug; exactly one of brand and brandId',
    example: 'bmw',
    pattern: '^[a-z0-9-]{1,80}$',
  })
  @ValidateIf((query: GaragePinsQueryDto) => query.brand !== undefined)
  @IsString()
  @Matches(/^[a-z0-9-]{1,80}$/)
  @ValidateBy({
    name: 'brandOrBrandId',
    validator: {
      defaultMessage: () => 'give brand or brandId, not both',
      validate: (_value, args) =>
        ((args as ValidationArguments).object as GaragePinsQueryDto).brandId ===
        undefined,
    },
  })
  brand?: string;

  @ApiPropertyOptional({
    description:
      'The brand, by its catalogue id; exactly one of brand and brandId',
    format: 'uuid',
  })
  @ValidateIf((query: GaragePinsQueryDto) => query.brand === undefined)
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({
    default: SEARCH_RADII[0],
    description:
      'Km around near that a fixed garage may be; a mobile mechanic counts by its own area. Ignored without near',
    enum: SEARCH_RADII,
    type: 'integer',
  })
  // Only the digits "25" or "50": Number() would also read "2.5e1" or "0x19"
  // as 25, and IsOptional would let a null through.
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) =>
    value === '25' || value === '50' ? Number(value) : value,
  )
  @IsIn(SEARCH_RADII)
  radius?: SearchRadius;

  @ApiPropertyOptional({
    description: `The visible area of the map, "south,west,north,east" in Romania, at most ${SEARCH_BBOX_MAX_KM} km on a side; rounded to three decimals. With it, a fixed garage counts when it stands inside the box, whatever the radius`,
    example: '44.35,26,44.5,26.25',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsSearchBbox()
  bbox?: string;
}

export class GarageSearchQueryDto extends GaragePinsQueryDto {
  @ApiPropertyOptional({
    description: `Up to ${SEARCH_IDS_MAX} garage ids, comma-separated: answers those of them that are public, in the search's order, with no cursor`,
    example: '9f1c2a7b-0000-4000-8000-000000000001',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsGarageIdList('ids')
  ids?: string;

  @ApiPropertyOptional({
    description:
      'Marks a new search, which the search log counts once; a re-read, retry or wider search leaves it out',
    enum: ['1'],
  })
  @IsOptional()
  @IsIn(['1'])
  log?: '1';

  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page; opaque',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
}

export class ListedGarageDto extends GarageBrandAnswerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Service Auto Nord' })
  name!: string;

  @ApiProperty({ example: 'service-auto-nord' })
  slug!: string;

  @ApiProperty({
    description:
      "The garage's answer for the brand; unstated when it has not marked it",
    enum: GARAGE_BRAND_ANSWERS,
  })
  stance!: GarageBrandAnswer;

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

  @ApiProperty({
    description: 'Out of 5, one decimal; null until reviewed',
    nullable: true,
    type: Number,
  })
  rating!: number | null;

  @ApiProperty({ type: 'integer' })
  reviewCount!: number;

  @ApiProperty({
    description: 'The hourly labour rate it starts from, in whole lei',
    nullable: true,
    type: 'integer',
  })
  labourFromLei!: number | null;

  @ApiProperty({ enum: BUSINESS_KINDS, nullable: true })
  businessKind!: BusinessKind | null;

  @ApiPropertyOptional({
    description: "The address's city; never for a mobile mechanic",
    example: 'Militari',
  })
  city?: string;

  @ApiPropertyOptional({
    description: "A mobile mechanic's area, in km; only for one",
    type: 'integer',
  })
  serviceRadiusKm?: number;

  @ApiProperty({
    description: 'The facilities it lists, in catalogue order',
    enum: FACILITIES,
    isArray: true,
  })
  facilities!: Facility[];
}

export class BrandCountsDto {
  @ApiProperty({
    description:
      'Approved garages that work on the brand, over everything found',
    type: 'integer',
  })
  worksOn!: number;

  @ApiProperty({
    description:
      'Approved garages that refuse the brand or have not marked it, over everything found',
    type: 'integer',
  })
  doesNotTake!: number;
}

export class GarageSearchPageDto {
  @ApiProperty({ type: BrandRefDto })
  brand!: BrandRefDto;

  @ApiProperty({
    description:
      'Garages that work on the brand first, then the rest; inside a group by rating (unrated last), then reviews, name and id; 20 at most',
    type: [ListedGarageDto],
  })
  items!: ListedGarageDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({
    description: 'Every approved garage: worksOn + doesNotTake',
    type: 'integer',
  })
  total!: number;

  @ApiProperty({ type: BrandCountsDto })
  counts!: BrandCountsDto;
}

export class GaragePinDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      "Where the pin stands; a mobile mechanic's area centre, two decimals",
    example: 44.437,
  })
  lat!: number;

  @ApiProperty({ example: 26.117 })
  lng!: number;

  @ApiProperty({
    description: 'The hourly labour rate it starts from, in whole lei',
    nullable: true,
    type: 'integer',
  })
  rateLei!: number | null;

  @ApiProperty({ enum: GARAGE_BRAND_ANSWERS })
  stance!: GarageBrandAnswer;

  @ApiPropertyOptional({
    description: "A mobile mechanic's area, in km; only for one",
    type: 'integer',
  })
  serviceRadiusKm?: number;
}

export class GaragePinsDto {
  @ApiProperty({
    description: `Every garage the search finds with a position, nearest first; ${SEARCH_PINS_MAX} at most`,
    type: [GaragePinDto],
  })
  pins!: GaragePinDto[];

  @ApiProperty({
    description: "Every approved garage the search finds, as the list's total",
    type: 'integer',
  })
  total!: number;
}
