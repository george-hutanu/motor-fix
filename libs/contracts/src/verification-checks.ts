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

// In the order the summary reads them when two problems weigh the same.
export const VERIFICATION_CHECK_KINDS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const;
export type VerificationCheckKind = (typeof VERIFICATION_CHECK_KINDS)[number];

export const VERIFICATION_CHECK_RESULTS = [
  'not_run',
  'ok',
  'warning',
  'failed',
] as const;
export type VerificationCheckResult =
  (typeof VERIFICATION_CHECK_RESULTS)[number];

// What an admin may record: a check goes back to not run only by a new file.
export const RECORDED_RESULTS = ['ok', 'warning', 'failed'] as const;

export const CHECK_DETAIL_MAX = 200;

export type Lamp = 'green' | 'amber' | 'red' | 'grey';

const LAMPS: Record<VerificationCheckResult, Lamp> = {
  failed: 'red',
  not_run: 'grey',
  ok: 'green',
  warning: 'amber',
};

export const lamp = (result: VerificationCheckResult): Lamp => LAMPS[result];

export type SummaryLanguage = 'ro' | 'en';

export interface SummaryCheck {
  kind: VerificationCheckKind;
  result: VerificationCheckResult;
  detail: string | null;
}

// Each kind as it reads inside a line; the line's first letter is raised.
const NAMES: Record<SummaryLanguage, Record<VerificationCheckKind, string>> = {
  en: {
    activities: 'activities',
    address: 'address',
    caen: 'CAEN code',
    company: 'Company ID',
    documents: 'documents',
    photos: 'photos',
    rar: 'RAR licence',
    representative: 'representative',
  },
  ro: {
    activities: 'activități',
    address: 'adresă',
    caen: 'cod CAEN',
    company: 'CUI',
    documents: 'documente',
    photos: 'fotografii',
    rar: 'autorizație RAR',
    representative: 'reprezentant',
  },
};

const TEXT = {
  en: {
    both: 'Company ID and RAR licence checked',
    company: 'Company ID checked',
    none: 'Not checked',
    rar: 'RAR licence checked',
    rarMissing: 'RAR licence missing',
  },
  ro: {
    both: 'CUI și autorizație RAR verificate',
    company: 'CUI verificat',
    none: 'Neverificat',
    rar: 'autorizație RAR verificată',
    rarMissing: 'lipsește autorizația RAR',
  },
} as const;

const SEVERITY: Partial<Record<VerificationCheckResult, number>> = {
  failed: 2,
  warning: 1,
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The most serious problem: a failure before a warning, rar before any other
// kind, then the kinds' order.
function worst(checks: readonly SummaryCheck[]) {
  const rank = (check: SummaryCheck) =>
    (SEVERITY[check.result] ?? 0) * 100 +
    (check.kind === 'rar' ? 50 : 0) -
    VERIFICATION_CHECK_KINDS.indexOf(check.kind);
  return checks
    .filter((check) => SEVERITY[check.result])
    .reduce<SummaryCheck | undefined>(
      (best, check) => (!best || rank(check) > rank(best) ? check : best),
      undefined,
    );
}

// The register checks that are ok, with Romanian agreement.
function registers(
  checks: readonly SummaryCheck[],
  text: (typeof TEXT)[SummaryLanguage],
) {
  const ok = (kind: VerificationCheckKind) =>
    checks.some((check) => check.kind === kind && check.result === 'ok');
  if (ok('company')) return ok('rar') ? text.both : text.company;
  return ok('rar') ? text.rar : undefined;
}

// The worst problem as the kind and its detail as typed; a failed rar reads
// as the licence missing.
function problem(checks: readonly SummaryCheck[], language: SummaryLanguage) {
  const found = worst(checks);
  if (!found) return undefined;
  if (found.kind === 'rar' && found.result === 'failed') {
    return TEXT[language].rarMissing;
  }
  return [NAMES[language][found.kind], found.detail].filter(Boolean).join(' ');
}

// One line for the queue: which register checks are ok, then the worst
// problem.
export function checkSummary(
  checks: readonly SummaryCheck[],
  language: SummaryLanguage,
): string {
  const parts = [
    registers(checks, TEXT[language]),
    problem(checks, language),
  ].filter((part): part is string => !!part);
  return parts.length ? capital(parts.join(' · ')) : TEXT[language].none;
}

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const given = (_: object, value: unknown) => value !== undefined;

export class RecordVerificationCheckDto {
  @ApiProperty({ enum: RECORDED_RESULTS })
  @IsIn(RECORDED_RESULTS)
  result!: (typeof RECORDED_RESULTS)[number];

  @ApiPropertyOptional({
    description:
      'Trimmed; required for warning and failed; replaces the stored detail',
    maxLength: CHECK_DETAIL_MAX,
  })
  @Transform(trimmed)
  @ValidateIf(given)
  @IsString()
  @Length(1, CHECK_DETAIL_MAX)
  @Matches(/^\P{Cc}*$/u, {
    message: 'detail must not hold control characters',
  })
  detail?: string;

  @ApiPropertyOptional({
    description:
      'RAR activity codes the authorisation covers; activities kind only, required when ok',
    type: [String],
  })
  @ValidateIf(given)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  activities?: string[];
}

export class VerificationCheckDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: VERIFICATION_CHECK_KINDS })
  kind!: VerificationCheckKind;

  @ApiProperty({ description: 'False until automatic look-ups exist' })
  automatic!: boolean;

  @ApiProperty({ enum: VERIFICATION_CHECK_RESULTS })
  result!: VerificationCheckResult;

  @ApiProperty({ nullable: true, type: String })
  detail!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  recordedBy!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  recordedAt!: Date | null;
}

export class CheckSummaryDto {
  @ApiProperty()
  ro!: string;

  @ApiProperty()
  en!: string;
}

export class VerificationCheckRecordedDto {
  @ApiProperty({ type: VerificationCheckDto })
  check!: VerificationCheckDto;

  @ApiProperty({ type: CheckSummaryDto })
  summary!: CheckSummaryDto;

  @ApiProperty({
    description: "The garage's RAR activity codes after the save",
    type: [String],
  })
  rarActivities!: string[];
}
