import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  DocumentCycleDto,
  type DocumentRow,
} from './legal-documents/document-cycle.dto';
import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from './legal-documents/legal-documents';
import {
  VERIFICATION_CHECK_RESULTS,
  type VerificationCheckResult,
} from './verification-checks';
import {
  RECHECK_FAILURES,
  RECHECK_RESULTS,
  type RecheckFailure,
  type RecheckResult,
} from './verification-target';

const LEGAL_CHECK_ROWS = ['company', 'caen', 'rar', 'documents'] as const;
type LegalCheckRowKind = (typeof LEGAL_CHECK_ROWS)[number];

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

  @ApiPropertyOptional({
    description:
      'The RAR row only: what the failed re-check that suspended the garage found',
    enum: RECHECK_FAILURES,
  })
  failure?: RecheckFailure;
}

export class RarActivityNameDto {
  @ApiProperty({ example: 'brakes' })
  code!: string;

  @ApiProperty({ example: 'frâne' })
  nameRo!: string;

  @ApiProperty({ example: 'brakes' })
  nameEn!: string;
}

export class LegalCheckRecheckDto {
  @ApiProperty({
    description: 'The Europe/Bucharest day checked',
    example: '2026-09-12',
    format: 'date',
  })
  checkedOn!: string;

  @ApiProperty({ enum: RECHECK_RESULTS })
  result!: RecheckResult;

  @ApiProperty({ enum: RECHECK_FAILURES, nullable: true })
  failure!: RecheckFailure | null;

  @ApiProperty({
    description: 'The recorded detail; null on ok',
    nullable: true,
    type: String,
  })
  detail!: string | null;
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

  @ApiProperty({ enum: ['approved', 'suspended'] })
  status!: 'approved' | 'suspended';

  @ApiProperty({
    description: 'The re-check recorded last; null when none',
    nullable: true,
    type: LegalCheckRecheckDto,
  })
  latestRecheck!: LegalCheckRecheckDto | null;

  @ApiProperty({
    description:
      "The garage's yearly documents cycle; null for a garage without one",
    nullable: true,
    type: DocumentCycleDto,
  })
  documents!: DocumentCycleDto | null;

  @ApiProperty({
    description: 'company, caen, rar and documents, in that order',
    isArray: true,
    type: LegalCheckRowDto,
  })
  rows!: LegalCheckRowDto[];
}

interface LegalCheckSource {
  checks: readonly {
    kind: string;
    result: VerificationCheckResult;
    detail: string | null;
    checkedOn: string | null;
  }[];
  documents: readonly { kind: string; status: string }[];
  lastCheckedOn: string | null;
  latestRecheck?: LegalCheckRecheckDto | null;
  recheckFailed?: boolean;
  // The yearly cycle's row; without one the row follows the documents held.
  cycleRow?: DocumentRow;
}

// The documents row's state by the yearly cycle's row.
const CYCLE_ROW_STATE: Record<DocumentRow, VerificationCheckResult> = {
  due: 'warning',
  in_review: 'warning',
  overdue: 'failed',
  refused: 'failed',
  valid: 'ok',
};

// A check row is its result; the RAR row is dated by the stored day of last
// check, which a valid re-check moves.
function checkRow(
  kind: 'company' | 'caen' | 'rar',
  check: LegalCheckSource['checks'][number] | undefined,
  lastCheckedOn: string | null,
): LegalCheckRowDto {
  const state = check?.result ?? 'not_run';
  const day =
    kind === 'rar' ? lastCheckedOn : (check?.checkedOn ?? lastCheckedOn);
  return {
    checkedOn: state === 'not_run' ? null : day,
    detail: state === 'ok' ? null : (check?.detail ?? null),
    kind,
    missing: [],
    state,
  };
}

// The RAR row of a failed re-check that suspended the garage.
const failedRecheckRow = (recheck: LegalCheckRecheckDto): LegalCheckRowDto => ({
  checkedOn: recheck.checkedOn,
  detail: recheck.detail,
  ...(recheck.failure ? { failure: recheck.failure } : {}),
  kind: 'rar',
  missing: [],
  state: 'failed',
});

// The panel's four rows from a file's checks and documents: the documents
// row follows the yearly cycle when the garage has one, and is in order only
// with both documents valid either way, and a failed re-check that
// suspended the garage stands in for the RAR row.
export function legalCheckRows({
  checks,
  cycleRow,
  documents,
  lastCheckedOn,
  latestRecheck,
  recheckFailed,
}: LegalCheckSource): LegalCheckRowDto[] {
  const failed =
    recheckFailed && latestRecheck?.result === 'failed' ? latestRecheck : null;
  const rows = (['company', 'caen', 'rar'] as const).map((kind) =>
    kind === 'rar' && failed
      ? failedRecheckRow(failed)
      : checkRow(
          kind,
          checks.find((c) => c.kind === kind),
          lastCheckedOn,
        ),
  );
  const missing = DOCUMENT_KINDS.filter(
    (kind) => !documents.some((d) => d.kind === kind && d.status === 'valid'),
  );
  // Green only with both documents valid, whatever the cycle says.
  const cycleState = cycleRow ? CYCLE_ROW_STATE[cycleRow] : 'ok';
  rows.push({
    checkedOn: lastCheckedOn,
    detail: null,
    kind: 'documents',
    missing,
    state: cycleState === 'ok' && missing.length ? 'warning' : cycleState,
  });
  return rows;
}
