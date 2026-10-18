import { ApiProperty } from '@nestjs/swagger';

import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from './legal-documents/legal-documents';
import {
  VERIFICATION_CHECK_RESULTS,
  type VerificationCheckResult,
} from './verification-checks';

export const LEGAL_CHECK_ROWS = [
  'company',
  'caen',
  'rar',
  'documents',
] as const;
export type LegalCheckRowKind = (typeof LEGAL_CHECK_ROWS)[number];

export class LegalCheckRowDto {
  @ApiProperty({ enum: LEGAL_CHECK_ROWS })
  kind!: LegalCheckRowKind;

  @ApiProperty({ enum: VERIFICATION_CHECK_RESULTS })
  state!: VerificationCheckResult;

  @ApiProperty({
    description: 'The Europe/Bucharest day it was checked; null when not run',
    example: '2026-10-01',
    format: 'date',
    nullable: true,
    type: String,
  })
  checkedOn!: string | null;

  @ApiProperty({
    description: "The check's recorded detail, only when it is not ok",
    nullable: true,
    type: String,
  })
  detail!: string | null;

  @ApiProperty({
    description: 'The documents row: each kind missing or not valid',
    enum: DOCUMENT_KINDS,
    isArray: true,
  })
  missing!: DocumentKind[];
}

export class RarActivityNameDto {
  @ApiProperty({ example: 'brakes' })
  code!: string;

  @ApiProperty({ example: 'frâne' })
  nameRo!: string;

  @ApiProperty({ example: 'brakes' })
  nameEn!: string;
}

export class LegalCheckDto {
  @ApiProperty({ example: 'ATELIER DINAMO SRL' })
  companyName!: string;

  @ApiProperty({ description: 'A mobile mechanic, with no workshop' })
  isMobile!: boolean;

  @ApiProperty({ isArray: true, type: RarActivityNameDto })
  rarActivities!: RarActivityNameDto[];

  @ApiProperty({
    example: '2026-10-01',
    format: 'date',
    nullable: true,
    type: String,
  })
  lastCheckedOn!: string | null;

  @ApiProperty({
    description: 'company, caen, rar and documents, in that order',
    isArray: true,
    type: LegalCheckRowDto,
  })
  rows!: LegalCheckRowDto[];
}

export interface LegalCheckSource {
  checks: readonly {
    kind: string;
    result: VerificationCheckResult;
    detail: string | null;
    checkedOn: string | null;
  }[];
  documents: readonly { kind: string; status: string }[];
  lastCheckedOn: string | null;
}

// The panel's four rows from a file's checks and documents: a check row is
// its result, the documents row is in order only with both documents valid.
export function legalCheckRows({
  checks,
  documents,
  lastCheckedOn,
}: LegalCheckSource): LegalCheckRowDto[] {
  const rows: LegalCheckRowDto[] = (['company', 'caen', 'rar'] as const).map(
    (kind) => {
      const check = checks.find((c) => c.kind === kind);
      const state = check?.result ?? 'not_run';
      return {
        checkedOn:
          state === 'not_run' ? null : (check?.checkedOn ?? lastCheckedOn),
        detail: state === 'ok' ? null : (check?.detail ?? null),
        kind,
        missing: [],
        state,
      };
    },
  );
  const missing = DOCUMENT_KINDS.filter(
    (kind) => !documents.some((d) => d.kind === kind && d.status === 'valid'),
  );
  rows.push({
    checkedOn: lastCheckedOn,
    detail: null,
    kind: 'documents',
    missing,
    state: missing.length ? 'warning' : 'ok',
  });
  return rows;
}
