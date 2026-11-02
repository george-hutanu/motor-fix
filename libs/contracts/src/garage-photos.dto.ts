import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Length,
  ValidateBy,
} from 'class-validator';

import { GARAGE_PHOTO_CAPTION_MAX } from './garage-profile-limits';
import { isRecord } from './is-record';
import { PHOTOS_MAX } from './listing-photos/listing-photos';
import { isFileKey, isId, trimmedWithin } from './listing-sections';

type GalleryError = { code: string; field: string };

const ENTRY_FIELDS = new Set(['caption', 'id', 'key']);
// Control characters, as the table's [[:cntrl:]] check refuses them.
const CONTROL = /\p{Cc}/u;

// A caption as stored: trimmed, and none when nothing is left.
export const photoCaption = (caption: unknown): string | null =>
  typeof caption === 'string' ? caption.trim() || null : null;

function captionError(caption: unknown, field: string): GalleryError[] {
  if (caption === undefined || caption === null) return [];
  if (typeof caption !== 'string') return [{ code: 'invalid', field }];
  if (CONTROL.test(caption.trim())) {
    return [{ code: 'caption_invalid', field }];
  }
  return trimmedWithin(caption, 0, GARAGE_PHOTO_CAPTION_MAX)
    ? []
    : [{ code: 'caption_too_long', field }];
}

// A gallery's own key: a kept upload of this purpose, never an incoming one.
const isPhotoKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith('garage_photo/') && isFileKey(key);

// An id names one photo in any letter case.
const sameCase = (id: unknown) =>
  typeof id === 'string' ? id.toLowerCase() : id;

// The rules the list's shape cannot say, each naming the entry it refuses:
// exactly one of `id` and `key`, neither sent twice, and the caption's limits.
export function galleryErrors(photos: unknown): GalleryError[] {
  if (!Array.isArray(photos)) return [{ code: 'invalid', field: 'photos' }];
  const ids = new Set<unknown>();
  const keys = new Set<unknown>();
  return photos.flatMap((entry: unknown, n): GalleryError[] => {
    const at = `photos[${n}]`;
    const shape = shapeError(entry, at);
    if (shape || !isRecord(entry)) return shape ? [shape] : [];
    const { caption, id, key } = entry;
    const reference =
      id === undefined
        ? referenceError(key, keys, isPhotoKey(key), `${at}.key`)
        : referenceError(sameCase(id), ids, isId(id), `${at}.id`);
    const errors = captionError(caption, `${at}.caption`);
    return reference ? [reference, ...errors] : errors;
  });
}

function shapeError(entry: unknown, at: string): GalleryError | null {
  if (!isRecord(entry)) return { code: 'invalid', field: at };
  if (Object.keys(entry).some((field) => !ENTRY_FIELDS.has(field))) {
    return { code: 'unknown_field', field: at };
  }
  const { id, key } = entry;
  return (id === undefined) === (key === undefined)
    ? { code: 'id_or_key', field: at }
    : null;
}

function referenceError(
  value: unknown,
  seen: Set<unknown>,
  valid: boolean,
  field: string,
): GalleryError | null {
  if (!valid) return { code: 'invalid', field };
  if (seen.has(value)) return { code: 'duplicate', field };
  seen.add(value);
  return null;
}

export class GaragePhotoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: '0 is the cover' })
  position!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  caption?: string | null;

  @ApiProperty({
    description: 'The thumbnail copy, signed for an hour',
    format: 'uri',
  })
  thumbnailUrl!: string;

  @ApiPropertyOptional({ minimum: 1 })
  width?: number;

  @ApiPropertyOptional({ minimum: 1 })
  height?: number;

  @ApiProperty({
    description: 'Always true: the gallery holds only processed photos',
  })
  processed!: boolean;
}

export class GaragePhotosDto {
  @ApiProperty({ description: "The profile's change stamp, sent back on save" })
  version!: string;

  @ApiProperty({ type: [GaragePhotoDto] })
  photos!: GaragePhotoDto[];
}

// An upload not yet in the gallery, as its copies are made.
export class GaragePhotoUploadDto {
  @ApiProperty({ description: 'The key to put in the gallery' })
  key!: string;

  @ApiProperty({ description: 'Whether the copies are made' })
  processed!: boolean;

  @ApiPropertyOptional({ description: 'Signed for an hour', format: 'uri' })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ minimum: 1 })
  width?: number;

  @ApiPropertyOptional({ minimum: 1 })
  height?: number;
}

// One photo of the saved gallery: a kept one by id, a new upload by key.
export class SaveGaragePhotoEntryDto {
  @ApiPropertyOptional({
    description: 'A photo the gallery holds',
    format: 'uuid',
  })
  id?: string;

  @ApiPropertyOptional({ description: 'An upload confirmed for this garage' })
  key?: string;

  @ApiPropertyOptional({
    description: 'Trimmed; empty clears it. No control characters',
    maxLength: GARAGE_PHOTO_CAPTION_MAX,
    nullable: true,
    type: String,
  })
  caption?: string | null;
}

// The whole gallery in its new order; what is left out is removed.
export class SaveGaragePhotosDto {
  @ApiProperty({
    description: "The profile's change stamp as last read",
    maxLength: 20,
    minLength: 1,
  })
  @IsString()
  @Length(1, 20)
  version!: string;

  @ApiProperty({
    description: 'Exactly one of id and key per entry; the first is the cover',
    maxItems: PHOTOS_MAX,
    minItems: 1,
    type: [SaveGaragePhotoEntryDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PHOTOS_MAX)
  @ValidateBy({
    name: 'galleryRules',
    validator: {
      defaultMessage: () => 'photos breaks a gallery rule',
      validate: (photos: unknown) => galleryErrors(photos).length === 0,
    },
  })
  photos!: SaveGaragePhotoEntryDto[];
}
