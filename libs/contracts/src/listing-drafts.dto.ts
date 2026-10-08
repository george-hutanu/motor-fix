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

import { type HoursSection, isHoursSection } from './garage-hours';
import {
  type DetailsSection,
  isDetailsSection,
  isMechanicsSection,
  isPricesSection,
  type MechanicsSection,
  type PricesSection,
} from './listing-sections';
import { isStep6Section, type Step6Section } from './listing-verification';
import { isPlaceSection, type PlaceSection } from './place-section';

const LANGUAGES = ['ro', 'en'] as const;
const DRAFT_STATUSES = ['open', 'submitted'] as const;
export type ListingDraftStatus = (typeof DRAFT_STATUSES)[number];

// The form's own data: one section per step, the survey, and the storage keys
// of the files the draft holds. Each step's story checks its own section.
export interface ListingDraftData {
  steps?: Partial<
    Record<'2', Record<string, unknown>> & {
      '1': DetailsSection;
      '3': PricesSection;
      '4': MechanicsSection;
      '5': Record<string, unknown> & HoursSection & { place?: PlaceSection };
      '6': Step6Section;
    }
  >;
  survey?: Record<string, unknown>;
  files?: string[];
}

const SECTION_GUARDS: Record<string, (section: unknown) => boolean> = {
  '1': isDetailsSection,
  '2': (section) => isRecord(section),
  '3': isPricesSection,
  '4': isMechanicsSection,
  '5': (section) =>
    isHoursSection(section) &&
    (section['place'] === undefined || isPlaceSection(section['place'])),
  '6': isStep6Section,
};
const FILE_KEY = /^[a-z-]+\/[0-9a-f-]{36}\/[\w-]{1,64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The envelope only: an object holding nothing but those three keys.
export function isListingDraftData(value: unknown): value is ListingDraftData {
  if (!isRecord(value)) return false;
  const { files, steps, survey, ...rest } = value;
  if (Object.keys(rest).length > 0) return false;
  if (survey !== undefined && !isRecord(survey)) return false;
  if (
    files !== undefined &&
    !(
      Array.isArray(files) &&
      files.every((key) => typeof key === 'string' && FILE_KEY.test(key))
    )
  )
    return false;
  if (steps === undefined) return true;
  return (
    isRecord(steps) &&
    Object.entries(steps).every(
      ([key, section]) =>
        Object.hasOwn(SECTION_GUARDS, key) && SECTION_GUARDS[key](section),
    )
  );
}

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
