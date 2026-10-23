import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  DOCUMENT_KINDS,
  DOCUMENT_PAGES_MAX,
  type DocumentKind,
} from './legal-documents';
import { calendarDay } from '../cars.dto';
import {
  SUSPENSION_CAUSES,
  type SuspensionCause,
} from '../garage-suspension.dto';

// The days an overdue garage keeps its place on the map after its due date.
export const DOCUMENT_GRACE_DAYS = 14;

export const DOCUMENT_CYCLE_STATES = ['due', 'overdue'] as const;
export type DocumentCycleState = (typeof DOCUMENT_CYCLE_STATES)[number];

// What the documents row shows: valid, near its due date, waiting for an
// admin, refused, or overdue.
export const DOCUMENT_ROWS = [
  'valid',
  'due',
  'in_review',
  'refused',
  'overdue',
] as const;
export type DocumentRow = (typeof DOCUMENT_ROWS)[number];

// Why an admin refuses a yearly document: the documents themselves, or
// something the note explains.
export const DOCUMENT_REFUSAL_REASONS = ['documents', 'other'] as const;
export type DocumentRefusalReason = (typeof DOCUMENT_REFUSAL_REASONS)[number];

export const DOCUMENT_REFUSAL_NOTE_MAX = 500;

// Line breaks are the only control characters a note may hold.
const NOTE_TEXT = /^(?:[\t\n\r]|\P{Cc})*$/u;

// The newest refusal of a kind whose newest upload was refused.
export class DocumentCycleRefusalDto {
  @ApiProperty({ enum: DOCUMENT_KINDS })
  kind!: DocumentKind;

  @ApiProperty({ enum: DOCUMENT_REFUSAL_REASONS })
  reason!: DocumentRefusalReason;

  @ApiProperty({ description: "The admin's note, shown to the garage" })
  note!: string;

  @ApiProperty({ format: 'date-time' })
  decidedAt!: string;
}

// When a garage owes its yearly documents again, and where it stands.
export class DocumentCycleDto {
  @ApiProperty({
    description: 'The Europe/Bucharest day both documents are due',
    example: '2027-01-15',
    format: 'date',
  })
  dueOn!: string;

  @ApiProperty({ enum: DOCUMENT_CYCLE_STATES })
  state!: DocumentCycleState;

  @ApiProperty({
    description: 'The last day of the grace; set once the cycle is overdue',
    example: '2027-01-29',
    format: 'date',
    nullable: true,
    type: String,
  })
  graceUntil!: string | null;

  @ApiProperty({ description: 'Whether a yearly upload waits for an admin' })
  inReview!: boolean;

  @ApiProperty({ enum: DOCUMENT_ROWS })
  row!: DocumentRow;

  @ApiProperty({
    description: 'Whether the garage may send its documents now',
  })
  canUpload!: boolean;

  @ApiProperty({ nullable: true, type: DocumentCycleRefusalDto })
  refusal!: DocumentCycleRefusalDto | null;
}

// The admin's refusal of one yearly document.
export class DocumentRefusalDto {
  @ApiProperty({ enum: DOCUMENT_REFUSAL_REASONS })
  @IsIn(DOCUMENT_REFUSAL_REASONS)
  reason!: DocumentRefusalReason;

  @ApiProperty({
    description: 'Trimmed; shown to the garage as written',
    maxLength: DOCUMENT_REFUSAL_NOTE_MAX,
    minLength: 1,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, DOCUMENT_REFUSAL_NOTE_MAX)
  @Matches(NOTE_TEXT, { message: 'note must not hold control characters' })
  note!: string;
}

export class DecidedDocumentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: DOCUMENT_KINDS })
  kind!: DocumentKind;

  @ApiProperty({ enum: ['valid', 'refused'] })
  status!: 'valid' | 'refused';

  @ApiProperty({ format: 'date-time' })
  decidedAt!: string;
}

// The answer to an admin's decision: the document, the garage's cycle after
// it, and the cause of an open suspension, for the way back to the map.
export class DocumentDecisionDto {
  @ApiProperty({ type: DecidedDocumentDto })
  document!: DecidedDocumentDto;

  @ApiProperty({
    description: "The garage's cycle after the decision",
    nullable: true,
    type: DocumentCycleDto,
  })
  cycle!: DocumentCycleDto | null;

  @ApiProperty({ enum: SUSPENSION_CAUSES, nullable: true })
  suspendedFor!: SuspensionCause | null;
}

// One yearly document as the owner sends it: the keys its upload addresses
// gave, in page order.
export class RenewedDocumentDto {
  @ApiProperty({ enum: DOCUMENT_KINDS })
  @IsIn(DOCUMENT_KINDS)
  kind!: DocumentKind;

  @ApiProperty({
    description: 'The keys the upload addresses gave, in page order',
    maxItems: DOCUMENT_PAGES_MAX,
    minItems: 1,
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_PAGES_MAX)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  pages!: string[];

  @ApiProperty({ example: '2026-10-20', format: 'date' })
  @calendarDay()
  issuedOn!: string;
}

// Both kinds, or one alone when the other was accepted since the cycle was
// last reset or waits for an admin: the service decides that.
export class DocumentsSubmitDto {
  @ApiProperty({
    maxItems: DOCUMENT_KINDS.length,
    minItems: 1,
    type: [RenewedDocumentDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_KINDS.length)
  @ArrayUnique((document: RenewedDocumentDto) => document?.kind)
  @ValidateNested({ each: true })
  @Type(() => RenewedDocumentDto)
  documents!: RenewedDocumentDto[];
}
