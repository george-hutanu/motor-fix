import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  DOCUMENT_KINDS,
  DOCUMENT_PAGES_MAX,
  type DocumentKind,
} from './legal-documents';
import { calendarDay } from '../cars.dto';

// The days an overdue garage keeps its place on the map after its due date.
export const DOCUMENT_GRACE_DAYS = 14;

export const DOCUMENT_CYCLE_STATES = ['due', 'overdue'] as const;
export type DocumentCycleState = (typeof DOCUMENT_CYCLE_STATES)[number];

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
