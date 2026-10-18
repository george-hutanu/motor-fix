import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { AuditEntryDto, JSON_VALUE } from './audit-history.dto';
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
import {
  VERIFICATION_CHANGE_AREAS,
  VERIFICATION_NOTE_MAX,
  VERIFICATION_REASON_CODES,
  type VerificationChangeArea,
  type VerificationReasonCode,
} from './verification-target';

// The timeline's length; the total says how many more there are.
export const VERIFICATION_TIMELINE_MAX = 50;

// How many of a returned file's changes one read carries.
export const VERIFICATION_CHANGES_MAX = 200;

const BUSINESS_KINDS = ['company', 'pfa', 'ii', 'mobile'] as const;

const VERIFICATION_DECISIONS = [
  'approved',
  'more_requested',
  'rejected',
] as const;
type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

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

  @ApiProperty({
    description:
      'Sent again after a request for more, with no reopening since that request',
  })
  resubmitted!: boolean;

  @ApiProperty({
    description: 'When more was asked for; set only when resubmitted',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  requestedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  declaredAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  declaredByName!: string | null;

  @ApiProperty({
    description: "The garage's RAR authorisation number, normalised",
    nullable: true,
    type: String,
  })
  rarNumber!: string | null;
}

// An admin's correction of the file's RAR number. The service normalises it
// and refuses one too short or holding control characters.
export class CorrectRarNumberDto {
  @ApiProperty({
    description: 'Trimmed, upper-cased and cut at 40; at least 3 characters',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  rarNumber!: string;
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
    description:
      'The names of the other garages holding the same CUI, sorted; empty when none or no CUI',
    type: [String],
  })
  cuiAlsoUsedBy!: string[];

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

// A job of the garage's price list, with the RAR activity it falls under.
export class VerificationFileJobDto {
  @ApiProperty({ format: 'uuid' })
  jobTypeId!: string;

  @ApiProperty()
  nameRo!: string;

  @ApiProperty()
  nameEn!: string;

  @ApiProperty({ nullable: true, type: String })
  rarActivity!: string | null;
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

// One line of the garage's history after the request for more.
export class VerificationChangeDto {
  @ApiProperty({ enum: VERIFICATION_CHANGE_AREAS })
  area!: VerificationChangeArea;

  @ApiProperty({ description: 'garage, garage_price, legal_document, …' })
  subjectType!: string;

  @ApiProperty({ nullable: true, type: String })
  field!: string | null;

  @ApiProperty({ enum: ['create', 'update', 'delete'] })
  action!: 'create' | 'update' | 'delete';

  @ApiProperty({
    description: "A legal document's kind",
    nullable: true,
    type: String,
  })
  kind!: string | null;

  @ApiProperty(JSON_VALUE)
  oldValue!: unknown;

  @ApiProperty(JSON_VALUE)
  newValue!: unknown;

  @ApiProperty({ format: 'date-time' })
  at!: string;
}

export class VerificationFileChangesDto {
  @ApiProperty()
  resubmitted!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  requestedAt!: string | null;

  @ApiProperty({
    description: 'Newest first, at most 200',
    type: [VerificationChangeDto],
  })
  changes!: VerificationChangeDto[];

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
    description: 'The whole RAR activity catalogue, by code',
    type: [VerificationFileActivityDto],
  })
  catalogue!: VerificationFileActivityDto[];

  @ApiProperty({
    description: "The garage's price-list jobs, once each, in the list's order",
    type: [VerificationFileJobDto],
  })
  jobs!: VerificationFileJobDto[];

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
