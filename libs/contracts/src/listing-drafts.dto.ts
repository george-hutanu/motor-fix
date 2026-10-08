import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { ListingDraftData } from './listing-sections';

const LANGUAGES = ['ro', 'en'] as const;
const DRAFT_STATUSES = ['open', 'submitted'] as const;
export type ListingDraftStatus = (typeof DRAFT_STATUSES)[number];

const lowerTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// The address is checked by the service against EMAIL_PATTERN, so a bad one
// answers with the field error the form shows.
class DraftFields {
  @ApiProperty({ description: 'The form data, whole every time' })
  @IsObject()
  data!: ListingDraftData;

  @ApiProperty({ maximum: 6, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(6)
  step!: number;

  @ApiProperty({ enum: LANGUAGES })
  @IsIn(LANGUAGES)
  language!: 'ro' | 'en';
}

export class CreateListingDraftDto extends DraftFields {
  @ApiProperty({ description: 'Trimmed and lower-cased', maxLength: 254 })
  @Transform(lowerTrimmed)
  @IsString()
  @MaxLength(1024)
  email!: string;
}

export class SaveListingDraftDto extends DraftFields {
  @ApiPropertyOptional({
    description: 'Trimmed and lower-cased',
    maxLength: 254,
  })
  @IsOptional()
  @Transform(lowerTrimmed)
  @IsString()
  @MaxLength(1024)
  email?: string;
}

export class ListingDraftSavedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: DRAFT_STATUSES })
  status!: ListingDraftStatus;

  @ApiProperty()
  step!: number;

  @ApiProperty({ enum: LANGUAGES })
  language!: 'ro' | 'en';

  @ApiProperty()
  email!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({
    description: "This browser's key, after the e-mail changed",
  })
  token?: string;

  @ApiPropertyOptional({ description: 'Whether a link e-mail was queued' })
  linkSent?: boolean;

  @ApiPropertyOptional({
    description: 'When no link was sent: seconds until one can be',
  })
  retryAfterSeconds?: number;
}

export class ListingDraftCreatedDto extends ListingDraftSavedDto {
  @ApiProperty({ description: "This browser's key to the draft" })
  declare token: string;

  @ApiProperty()
  declare linkSent: boolean;
}

export class ListingDraftDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  data!: ListingDraftData;

  @ApiProperty()
  step!: number;

  @ApiProperty({ enum: LANGUAGES })
  language!: 'ro' | 'en';

  @ApiProperty({ enum: DRAFT_STATUSES })
  status!: ListingDraftStatus;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ContinueLinkSentDto {
  @ApiProperty({ format: 'date-time' })
  sentAt!: string;
}
