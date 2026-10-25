import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  Max,
  Min,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';

import {
  STATIC_MAP_MAX,
  STATIC_MAP_SIZES,
  STATIC_MAP_THEMES,
  STATIC_MAP_ZOOM,
  type StaticMapSize,
  type StaticMapTheme,
} from './map-view';
import { ROMANIA_BOUNDS } from './place-section';

// A view is fixed by its query alone, so a browser keeps an image a day and
// the CDN a month, and either serves it stale for a week while it refreshes
// or while the tiles are down.
export const STATIC_MAP_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800';

// Number() alone would also read "1e1" or "0x1a"; only plain digits and one
// decimal point become a number, anything else stays and is refused.
const INTEGER = /^\d{1,5}$/;
const DECIMAL = /^-?\d{1,3}(\.\d{1,10})?$/;
const asNumber = (pattern: RegExp) =>
  Transform(({ value }) =>
    typeof value === 'string' && pattern.test(value) ? Number(value) : value,
  );

export class StaticMapQueryDto {
  @ApiProperty({ enum: STATIC_MAP_THEMES })
  @IsIn(STATIC_MAP_THEMES)
  theme!: StaticMapTheme;

  @ApiProperty({
    maximum: STATIC_MAP_ZOOM.max,
    minimum: STATIC_MAP_ZOOM.min,
    type: 'integer',
  })
  @asNumber(INTEGER)
  @IsInt()
  @Min(STATIC_MAP_ZOOM.min)
  @Max(STATIC_MAP_ZOOM.max)
  z!: number;

  @ApiProperty({
    description:
      'The centre’s latitude, in Romania; the answer is drawn at the nearest grid point',
    maximum: ROMANIA_BOUNDS.latMax,
    minimum: ROMANIA_BOUNDS.latMin,
  })
  @asNumber(DECIMAL)
  @IsNumber()
  @Min(ROMANIA_BOUNDS.latMin)
  @Max(ROMANIA_BOUNDS.latMax)
  lat!: number;

  @ApiProperty({
    maximum: ROMANIA_BOUNDS.lngMax,
    minimum: ROMANIA_BOUNDS.lngMin,
  })
  @asNumber(DECIMAL)
  @IsNumber()
  @Min(ROMANIA_BOUNDS.lngMin)
  @Max(ROMANIA_BOUNDS.lngMax)
  lng!: number;

  @ApiProperty({ enum: STATIC_MAP_SIZES, type: 'integer' })
  @asNumber(INTEGER)
  @IsIn(STATIC_MAP_SIZES)
  w!: StaticMapSize;

  @ApiProperty({
    description: `One of the widths; width × height at most ${STATIC_MAP_MAX.w} × ${STATIC_MAP_MAX.h}`,
    enum: STATIC_MAP_SIZES,
    type: 'integer',
  })
  @asNumber(INTEGER)
  @IsIn(STATIC_MAP_SIZES)
  @ValidateBy({
    name: 'staticMapArea',
    validator: {
      defaultMessage: () =>
        `h: width × height must be at most ${STATIC_MAP_MAX.w} × ${STATIC_MAP_MAX.h}`,
      // A width that is no number is refused on its own field.
      validate: (value: unknown, args?: ValidationArguments) => {
        const w = (args?.object as StaticMapQueryDto | undefined)?.w;
        return (
          typeof value !== 'number' ||
          typeof w !== 'number' ||
          w * value <= STATIC_MAP_MAX.w * STATIC_MAP_MAX.h
        );
      },
    },
  })
  h!: StaticMapSize;
}
