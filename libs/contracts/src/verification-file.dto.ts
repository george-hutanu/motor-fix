import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

import { AuditEntryDto } from './audit-history.dto';
import {
  VERIFICATION_FILE_STATUSES,
  type VerificationFileStatus,
} from './garage-status';
import { PublicGaragePhotoDto } from './garages.dto';
import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from './legal-documents/legal-documents';
import {
  VerificationActorDto,
  VerificationFileCheckDto,
} from './verification-checks';

// The timeline's length; the total says how many more there are.
export const VERIFICATION_TIMELINE_MAX = 50;

const BUSINESS_KINDS = ['company', 'pfa', 'ii', 'mobile'] as const;

const VERIFICATION_DECISIONS = [
  'approved',
  'more_requested',
  'rejected',
] as const;
type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

// What a rejection names, and what a request for more may ask for.
const VERIFICATION_REASON_CODES = [
  'documents',
  'rar',
  'address',
  'photos',
  'other',
] as const;
type VerificationReasonCode = (typeof VERIFICATION_REASON_CODES)[number];

const VERIFICATION_NOTE_MAX = 1000;

// A note blank after trimming is no note: the use case asks for one where
// the decision needs it.
const note = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
};
const given = (_: object, value: unknown) => value !== undefined;

export class VerificationDecisionDto {
  @ApiProperty({ enum: VERIFICATION_DECISIONS })
  @IsIn(VERIFICATION_DECISIONS)
  decision!: VerificationDecision;

  @ApiPropertyOptional({
    description: 'Required with rejected, optional with more_requested',
    enum: VERIFICATION_REASON_CODES,
  })
  @ValidateIf(given)
  @IsIn(VERIFICATION_REASON_CODES)
  reason?: VerificationReasonCode;

  @ApiPropertyOptional({
    description: 'What is missing; only with more_requested',
    enum: VERIFICATION_REASON_CODES,
    isArray: true,
  })
  @ValidateIf(given)
  @IsArray()
  @ArrayMaxSize(VERIFICATION_REASON_CODES.length)
  @IsIn(VERIFICATION_REASON_CODES, { each: true })
  requestedItems?: VerificationReasonCode[];

  @ApiPropertyOptional({
    description:
      'Trimmed; required with rejected and more_requested, optional with approved',
    maxLength: VERIFICATION_NOTE_MAX,
  })
  @Transform(note)
  @ValidateIf(given)
  @IsString()
  @Length(1, VERIFICATION_NOTE_MAX)
  // A note is written in a text area: line breaks and tabs are its own.
  @Matches(/^(?:[\t\n\r]|\P{Cc})*$/u, {
    message: 'note must not hold control characters',
  })
  note?: string;
}

export class VerificationFileStateDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: VERIFICATION_FILE_STATUSES })
  status!: VerificationFileStatus;

  @ApiProperty({ description: 'The latest sending', format: 'date-time' })
  submittedAt!: string;

  @ApiProperty({ nullable: true, type: VerificationActorDto })
  openedBy!: VerificationActorDto | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  openedAt!: string | null;

  @ApiProperty({ nullable: true, type: VerificationActorDto })
  decidedBy!: VerificationActorDto | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  decidedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  reasonCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  reasonNote!: string | null;

  @ApiProperty({
    description: 'What the latest request for more asked for; empty otherwise',
    type: [String],
  })
  requestedItems!: string[];

  @ApiProperty({ nullable: true, type: VerificationActorDto })
  reopenedBy!: VerificationActorDto | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  reopenedAt!: string | null;

  @ApiProperty({ enum: ['garage_report'], nullable: true, type: String })
  reopenReason!: 'garage_report' | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  declaredAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  declaredByName!: string | null;
}

export class VerificationFileGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: BUSINESS_KINDS, nullable: true, type: String })
  businessKind!: (typeof BUSINESS_KINDS)[number] | null;

  @ApiProperty({ description: 'Digits only', nullable: true, type: String })
  cui!: string | null;

  @ApiProperty({
    description: 'The workshop; null for a mobile mechanic',
    nullable: true,
    type: String,
  })
  address!: string | null;

  @ApiProperty({
    description: "A mobile mechanic's registered seat",
    nullable: true,
    type: String,
  })
  seatAddress!: string | null;

  @ApiProperty({ nullable: true, type: 'integer' })
  serviceRadiusKm!: number | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({
    description: 'The brands it works on, by name',
    type: [String],
  })
  brands!: string[];

  @ApiProperty({ type: [PublicGaragePhotoDto] })
  photos!: PublicGaragePhotoDto[];
}

export class VerificationFileActivityDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  nameRo!: string;

  @ApiProperty()
  nameEn!: string;
}

export class VerificationFileDocumentDto {
  @ApiProperty({ enum: DOCUMENT_KINDS })
  kind!: DocumentKind;

  @ApiProperty()
  present!: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  id!: string | null;

  @ApiProperty({ minimum: 0, type: 'integer' })
  pages!: number;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  issuedOn!: string | null;

  @ApiProperty({
    description:
      'The certificate only: no issue date, or issued more than 30 days before the latest sending; null for every other kind',
    nullable: true,
    type: Boolean,
  })
  stale!: boolean | null;
}

export class VerificationFileReportDto {
  @ApiProperty({ description: 'Plain text, as the reporter wrote it' })
  text!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class VerificationFileRejectionDto {
  @ApiProperty({ nullable: true, type: String })
  reasonCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  reasonNote!: string | null;

  @ApiProperty({ format: 'date-time' })
  decidedAt!: string;
}

export class VerificationFileTimelineDto {
  @ApiProperty({
    description: 'Newest first, at most 50',
    type: [AuditEntryDto],
  })
  entries!: AuditEntryDto[];

  @ApiProperty({ minimum: 0, type: 'integer' })
  total!: number;
}

export class VerificationFileDto {
  @ApiProperty({ type: VerificationFileStateDto })
  file!: VerificationFileStateDto;

  @ApiProperty({ type: VerificationFileGarageDto })
  garage!: VerificationFileGarageDto;

  @ApiProperty({
    description: 'The 8 kinds, in their order',
    type: [VerificationFileCheckDto],
  })
  checks!: VerificationFileCheckDto[];

  @ApiProperty({
    description: "The garage's recorded RAR activities",
    type: [VerificationFileActivityDto],
  })
  activities!: VerificationFileActivityDto[];

  @ApiProperty({
    description: 'One per kind, in their order',
    type: [VerificationFileDocumentDto],
  })
  documents!: VerificationFileDocumentDto[];

  @ApiProperty({ description: 'Whether the document store answers' })
  storageReady!: boolean;

  @ApiProperty({
    description: "The garage's open reports, newest first",
    type: [VerificationFileReportDto],
  })
  reports!: VerificationFileReportDto[];

  @ApiProperty({ nullable: true, type: VerificationFileRejectionDto })
  previousRejection!: VerificationFileRejectionDto | null;

  @ApiProperty({ type: VerificationFileTimelineDto })
  timeline!: VerificationFileTimelineDto;
}
