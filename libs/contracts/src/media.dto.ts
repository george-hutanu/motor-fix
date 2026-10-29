import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';

import { DOWNLOAD_URL_MINUTES, FILE_RULES, UPLOAD_URL_MINUTES } from './files';

export const MEDIA_KINDS = ['photo', 'clip', 'live'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
// A kept recording is created by the live service, never uploaded.
export const MEDIA_UPLOAD_KINDS = ['photo', 'clip'] as const;
export type MediaUploadKind = (typeof MEDIA_UPLOAD_KINDS)[number];

export const MEDIA_STATUSES = [
  'processing',
  'visible',
  'failed',
  'removed',
  'purged',
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_REFUSALS = [
  'file_type_not_allowed',
  'file_too_large',
  'clip_too_long',
  'file_type_mismatch',
  'file_missing',
  'job_handed_over',
  'job_not_in_work',
  'storage_unavailable',
  'invalid_state',
  'forbidden',
  'not_found',
] as const;
export type MediaRefusal = (typeof MEDIA_REFUSALS)[number];

export const MEDIA_FILE_VARIANTS = ['file', 'thumbnail'] as const;
export type MediaFileVariant = (typeof MEDIA_FILE_VARIANTS)[number];

export const MEDIA_LIMITS = {
  captionChars: 140,
  clipBytes: FILE_RULES.media_clip.maxBytes,
  clipSeconds: 60,
  clipShortSidePx: 720,
  // A phone's declared length rounds; the worker refuses past this margin.
  clipToleranceSeconds: 1,
  conversionAttempts: 2,
  conversionTimeoutMs: 10 * 60_000,
  downloadUrlMinutes: DOWNLOAD_URL_MINUTES,
  photoPx: 2048,
  thumbPx: 480,
  uploadUrlMinutes: UPLOAD_URL_MINUTES,
} as const;

export class MediaUploadRequestDto {
  @ApiProperty({ enum: MEDIA_UPLOAD_KINDS })
  @IsIn(MEDIA_UPLOAD_KINDS)
  kind!: MediaUploadKind;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({ description: 'Bytes', minimum: 1 })
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiProperty({
    description: 'Base64 of the CRC32 of the file, big-endian',
    example: 'yPQ5Jg==',
  })
  @IsString()
  // Four bytes: five free characters, a sixth whose low four bits are zero.
  @Matches(/^[A-Za-z0-9+/]{5}[AQgw]==$/)
  checksum!: string;

  @ApiPropertyOptional({
    description: 'The clip length in whole seconds; a photo has none',
    minimum: 1,
  })
  // Over 60 passes here: the service answers it with clip_too_long.
  @ValidateBy({
    name: 'lengthOfKind',
    validator: {
      defaultMessage: () =>
        'seconds is a whole number from 1 for a clip and absent for a photo',
      validate: (value, args) =>
        (args?.object as MediaUploadRequestDto | undefined)?.kind === 'clip'
          ? Number.isInteger(value) && (value as number) >= 1
          : value === undefined,
    },
  })
  seconds?: number;

  @ApiPropertyOptional({ maxLength: MEDIA_LIMITS.captionChars })
  @IsOptional()
  @IsString()
  @MaxLength(MEDIA_LIMITS.captionChars)
  caption?: string;
}

export class MediaFileQueryDto {
  @ApiPropertyOptional({ default: 'file', enum: MEDIA_FILE_VARIANTS })
  @IsOptional()
  @IsIn(MEDIA_FILE_VARIANTS)
  variant?: MediaFileVariant;
}

export class MediaItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ enum: MEDIA_KINDS })
  kind!: MediaKind;

  @ApiProperty({ enum: MEDIA_STATUSES })
  status!: MediaStatus;

  @ApiProperty({ nullable: true, type: String })
  caption!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  seconds!: number | null;

  @ApiProperty({ format: 'date-time' })
  sentAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  removedAt!: string | null;

  @ApiProperty({
    description: 'The account that sent it; none for a kept recording',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  senderId!: string | null;

  @ApiProperty()
  hasThumbnail!: boolean;
}

export class MediaUploadTargetDto {
  @ApiProperty({ description: 'Where the app PUTs the file' })
  url!: string;

  @ApiProperty({
    additionalProperties: { type: 'string' },
    description: 'Headers to send with the PUT, exactly as given',
    type: 'object',
  })
  headers!: Record<string, string>;

  @ApiProperty()
  key!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class MediaUploadAddressDto {
  @ApiProperty({ type: MediaItemDto })
  item!: MediaItemDto;

  @ApiProperty({ type: MediaUploadTargetDto })
  upload!: MediaUploadTargetDto;
}

export class MediaListDto {
  @ApiProperty({ type: [MediaItemDto] })
  items!: MediaItemDto[];
}

export class MediaFileAddressDto {
  @ApiProperty({ description: 'Signed for 5 minutes' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
