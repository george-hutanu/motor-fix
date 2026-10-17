import {
  CHECK_DETAIL_MAX,
  checkSummary,
  isValidCui,
  RECORDED_RESULTS,
  type RecordVerificationCheckDto,
  VERIFICATION_CHECK_KINDS,
  type VerificationCheckEvidenceDto,
  type VerificationCheckKind,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { type Actor, requireCapability } from '../../../auth/policy';
import { refusal } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import {
  type BusinessKind,
  Prisma,
  type VerificationCheck,
  type VerificationFileStatus,
} from '../../../generated/prisma/client';

// A decision waits for the garage or closes the file; reopening it into review
// lets the admin record again.
const DECIDED: VerificationFileStatus[] = [
  'approved',
  'rejected',
  'more_requested',
];

const invalid = (message: string, errors?: { code: string; field: string }[]) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, errors);

const isKind = (kind: string): kind is VerificationCheckKind =>
  (VERIFICATION_CHECK_KINDS as readonly string[]).includes(kind);

// The fields each register check takes from the admin.
const FIELDS = {
  caen: ['certificate', 'onrc', 'address'],
  company: ['name'],
} as const;
type RegisterKind = keyof typeof FIELDS;
const isRegister = (kind: string): kind is RegisterKind => kind in FIELDS;

// The ticks as the form names them, in the form's order; the address tick
// reads as the workshop's, or the registered seat's for a mobile mechanic.
const TICKS = {
  address: { premises: 'la punctul de lucru', seat: 'la sediul social' },
  certificate: '4520 pe certificat',
  onrc: '4520 în ONRC',
} as const;
const tickName = (tick: keyof typeof TICKS, mobile: boolean) => {
  const name = TICKS[tick];
  return typeof name === 'string' ? name : name[mobile ? 'seat' : 'premises'];
};

// The details the server writes on an ok register check, stored in Romanian
// like every typed detail.
const companyOk = (name: string) => `CUI valid · ${name}`;
const CAEN_OK = {
  premises: 'Întreținerea și repararea autovehiculelor, la punctul de lucru',
  seat: 'Întreținerea și repararea autovehiculelor, la sediul social',
};

// Evidence belongs to a ticked register check, each kind to its own fields.
function evidenceShape(
  kind: VerificationCheckKind,
  body: RecordVerificationCheckDto,
) {
  const { evidence } = body;
  if (evidence === undefined) return;
  if (!isRegister(kind)) {
    throw invalid('evidence belongs to the company and CAEN checks');
  }
  if (body.result === 'not_run') {
    throw invalid('an unticked check carries no evidence');
  }
  const other = kind === 'company' ? FIELDS.caen : FIELDS.company;
  const stray = other.find((field) => evidence[field] !== undefined);
  if (stray) throw invalid(`${stray} does not belong to the ${kind} check`);
}

interface RegisterFacts {
  businessKind: BusinessKind | null;
  certificateUploaded: boolean;
  cui: string | null;
}

interface RegisterRecord {
  detail?: string;
  evidence: VerificationCheckEvidenceDto;
}

// The company check: OK needs the name the register shows and a CUI that
// passes the validator; the server writes the detail itself.
function companyRecord(
  body: RecordVerificationCheckDto,
  facts: RegisterFacts,
): RegisterRecord {
  const name = body.evidence?.name?.trim();
  const lookedUpOn = localDay(new Date());
  if (body.result !== 'ok') {
    return { evidence: { ...(name && { name }), lookedUpOn } };
  }
  if (!name) {
    throw invalid('Lipsește numele firmei', [
      { code: 'required', field: 'evidence.name' },
    ]);
  }
  if (!isValidCui(facts.cui ?? '')) {
    throw invalid('CUI-ul service-ului nu e valid', [
      { code: 'invalid', field: 'cui' },
    ]);
  }
  return { detail: companyOk(name), evidence: { lookedUpOn, name } };
}

// The CAEN check: OK needs every tick, the certificate's only when the file
// holds one; the ticks are stored as sent, with what the server read.
function caenRecord(
  body: RecordVerificationCheckDto,
  facts: RegisterFacts,
): RegisterRecord {
  const ticks = {
    address: body.evidence?.address === true,
    certificate: body.evidence?.certificate === true,
    onrc: body.evidence?.onrc === true,
  };
  const evidence = {
    ...ticks,
    certificateUploaded: facts.certificateUploaded,
    lookedUpOn: localDay(new Date()),
  };
  if (body.result !== 'ok') return { evidence };
  const missing = FIELDS.caen.filter(
    (tick) =>
      !ticks[tick] && (tick !== 'certificate' || facts.certificateUploaded),
  );
  const mobile = facts.businessKind === 'mobile';
  if (missing.length) {
    throw invalid(
      `Lipsește: ${missing.map((t) => tickName(t, mobile)).join(', ')}`,
      missing.map((t) => ({ code: 'required', field: `evidence.${t}` })),
    );
  }
  return { detail: mobile ? CAEN_OK.seat : CAEN_OK.premises, evidence };
}

// One side of a check's audit entry: the activities check carries its list,
// a register check its evidence.
function auditValue(
  kind: VerificationCheckKind,
  check: Pick<VerificationCheck, 'detail' | 'evidence' | 'result'>,
  activities: string[] | undefined,
) {
  return {
    ...(activities && { activities }),
    detail: check.detail,
    ...(isRegister(kind) && { evidence: check.evidence }),
    result: check.result,
  };
}

// The detail as stored: trimmed, at most 200 characters, required for a
// problem and refused when the check is unticked.
function detailOf(body: RecordVerificationCheckDto) {
  const detail = body.detail?.trim() || null;
  if (detail && detail.length > CHECK_DETAIL_MAX) {
    throw invalid(`detail must be at most ${CHECK_DETAIL_MAX} characters`);
  }
  if (body.result === 'not_run' && detail) {
    throw invalid('an unticked check carries no detail');
  }
  if ((body.result === 'warning' || body.result === 'failed') && !detail) {
    throw invalid('a warning or a failure needs a detail');
  }
  return detail;
}

// The body's own rules, beyond its shape: a problem says what it is, and a
// list belongs to the activities check alone.
function validated(
  kind: VerificationCheckKind,
  body: RecordVerificationCheckDto,
) {
  if (!(RECORDED_RESULTS as readonly string[]).includes(body.result)) {
    throw invalid('result must be ok, warning, failed or not_run');
  }
  const detail = detailOf(body);
  evidenceShape(kind, body);
  if (body.activities !== undefined && kind !== 'activities') {
    throw invalid('activities belong to the activities check');
  }
  if (body.activities !== undefined && body.result === 'not_run') {
    throw invalid('an unticked check carries no activities');
  }
  if (kind === 'activities' && body.result === 'ok' && !body.activities) {
    throw invalid('an ok activities check needs the list');
  }
  return {
    activities: body.activities && [...new Set(body.activities)],
    detail,
    result: body.result,
  };
}

// An admin's record of one check of a file, in the caller's transaction: the
// result, its history entry and its event commit together.
@Injectable()
export class VerificationChecksService {
  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    fileId: string,
    kind: string,
    body: RecordVerificationCheckDto,
  ) {
    requireCapability(actor, 'admin.garages');
    const file = await this.file(tx, fileId);
    if (DECIDED.includes(file.status)) {
      throw refusal(
        HttpStatus.CONFLICT,
        'verification_file_decided',
        'Dosarul e deja decis',
      );
    }
    if (!isKind(kind)) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'verification_check_kind_unknown',
        `Unknown check kind: ${kind}`,
      );
    }
    const next = validated(kind, body);
    if (next.activities) await this.known(tx, next.activities);
    const register = await this.register(tx, kind, body, file, fileId);

    const [before] = await tx.$queryRaw<
      Pick<VerificationCheck, 'id' | 'result' | 'detail' | 'evidence'>[]
    >`SELECT id, result::text AS result, detail, evidence FROM verification_check
      WHERE file_id = ${fileId}::uuid AND kind = ${kind}::verification_check_kind
      FOR UPDATE`;
    if (!before) throw new NotFoundException();
    const check = await tx.verificationCheck.update({
      data: {
        detail: register?.detail ?? next.detail,
        // Only this write shapes the evidence, from the validated body and the
        // facts read here, so its readers cast the column back unchecked.
        evidence: register
          ? (register.evidence as Prisma.InputJsonObject)
          : Prisma.DbNull,
        recordedAt: new Date(),
        recordedBy: actor.accountId,
        result: next.result,
      },
      where: { id: before.id },
    });
    // The activities check's entry always carries the list, sent or kept.
    const held =
      kind === 'activities'
        ? await this.lockedActivities(tx, file.garageId)
        : undefined;
    const activities = held && { after: next.activities ?? held, before: held };
    if (next.activities) {
      await tx.garage.update({
        data: { rarActivities: next.activities },
        where: { id: file.garageId },
      });
      // The activities decide which of its jobs the public profile lists.
      await this.events.record(tx, {
        audience: {
          garageId: file.garageId,
          results: false,
          type: 'public_garage',
        },
        kind: 'price_list.updated',
        payload: {},
        subjectId: file.garageId,
      });
    }

    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: kind,
      garageId: file.garageId,
      kind: 'verification_check_recorded',
      newValue: auditValue(kind, check, activities?.after),
      oldValue: auditValue(kind, before, activities?.before),
      subjectId: check.id,
      subjectType: 'verification_check',
    });
    await this.events.record(tx, {
      audience: { type: 'platform' },
      kind: 'verification.check_recorded',
      payload: { fileId, kind, result: check.result },
      subjectId: fileId,
    });

    const checks = await tx.verificationCheck.findMany({
      select: { detail: true, kind: true, result: true },
      where: { fileId },
    });
    const garage = await tx.garage.findUniqueOrThrow({
      select: { rarActivities: true },
      where: { id: file.garageId },
    });
    return {
      check: {
        ...check,
        evidence: check.evidence as VerificationCheckEvidenceDto | null,
      },
      rarActivities: garage.rarActivities,
      summary: {
        en: checkSummary(checks, 'en'),
        ro: checkSummary(checks, 'ro'),
      },
    };
  }

  private async file(tx: Prisma.TransactionClient, id: string) {
    // PostgreSQL refuses a malformed uuid outright; it is an unknown id.
    if (!isUUID(id)) throw new NotFoundException();
    // Held until the save commits, so a decision racing it waits and the
    // record cannot land on a file decided meanwhile.
    const [file] = await tx.$queryRaw<
      { garageId: string; status: VerificationFileStatus }[]
    >`SELECT garage_id AS "garageId", status::text AS status
      FROM verification_file WHERE id = ${id}::uuid FOR SHARE`;
    if (!file) throw new NotFoundException();
    return file;
  }

  // A register check's record, unless it is cleared.
  private async register(
    tx: Prisma.TransactionClient,
    kind: VerificationCheckKind,
    body: RecordVerificationCheckDto,
    file: { garageId: string },
    fileId: string,
  ): Promise<RegisterRecord | undefined> {
    if (!isRegister(kind) || body.result === 'not_run') return undefined;
    const facts = await this.facts(tx, fileId, file);
    return kind === 'company'
      ? companyRecord(body, facts)
      : caenRecord(body, facts);
  }

  // What the server reads itself for a register check: the garage's CUI and
  // kind, and whether the file holds an ONRC certificate.
  private async facts(
    tx: Prisma.TransactionClient,
    fileId: string,
    file: { garageId: string },
  ): Promise<RegisterFacts> {
    const [garage, certificates] = await Promise.all([
      tx.garage.findUniqueOrThrow({
        select: { businessKind: true, cui: true },
        where: { id: file.garageId },
      }),
      tx.legalDocument.count({
        where: { kind: 'onrc_certificate', verificationFileId: fileId },
      }),
    ]);
    return { ...garage, certificateUploaded: certificates > 0 };
  }

  private async known(tx: Prisma.TransactionClient, codes: string[]) {
    const found = await tx.rarActivity.count({
      where: { code: { in: codes } },
    });
    if (found !== codes.length) throw invalid('unknown RAR activity code');
  }

  // The garage's list before the save, held until it commits.
  private async lockedActivities(
    tx: Prisma.TransactionClient,
    garageId: string,
  ) {
    const [garage] = await tx.$queryRaw<{ rar_activities: string[] }[]>`
      SELECT rar_activities FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
    return garage?.rar_activities ?? [];
  }
}
