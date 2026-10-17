import {
  CHECK_DETAIL_MAX,
  checkSummary,
  isValidCui,
  RECORDED_RESULTS,
  type RecordVerificationCheckDto,
  uncoveredJobs,
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
import { firstName } from '../../../audit/audit.service';
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
import { pricedJobs } from '../priced-jobs';

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

// The fields each register check takes from the admin; the activities check
// takes none, its evidence is the server's alone.
const CAEN_TICKS = ['certificate', 'onrc', 'address'] as const;
const RAR_TICKS = ['found', 'sameCompany', 'sameAddress'] as const;
const FIELDS: Record<RegisterKind, readonly AdminField[]> = {
  activities: [],
  caen: CAEN_TICKS,
  company: ['name'],
  rar: RAR_TICKS,
};
type RegisterKind = 'company' | 'caen' | 'rar' | 'activities';
type AdminField =
  | 'name'
  | 'certificate'
  | 'onrc'
  | 'address'
  | 'found'
  | 'sameCompany'
  | 'sameAddress';
const ADMIN_FIELDS = [...new Set(Object.values(FIELDS).flat())];
const isRegister = (kind: string): kind is RegisterKind => kind in FIELDS;

// The ticks as the form names them, in the form's order; the address ticks
// read as the workshop's, or the registered seat's for a mobile mechanic.
const TICKS = {
  address: { premises: 'la punctul de lucru', seat: 'la sediul social' },
  certificate: '4520 pe certificat',
  found: 'găsită',
  onrc: '4520 în ONRC',
  sameAddress: { premises: 'aceeași adresă', seat: 'același sediu social' },
  sameCompany: 'aceeași firmă',
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
const RAR_OK = {
  premises: 'aceeași firmă și adresă',
  seat: 'aceeași firmă și sediu social',
};
const ACTIVITIES_OK = 'toate lucrările sunt acoperite';

// Evidence belongs to a ticked check that takes it, each kind to its own
// fields; what the server writes itself is ignored when sent.
function evidenceShape(
  kind: VerificationCheckKind,
  body: RecordVerificationCheckDto,
) {
  const { evidence } = body;
  if (evidence === undefined) return;
  if (!isRegister(kind) || FIELDS[kind].length === 0) {
    throw invalid('evidence belongs to the company, CAEN and RAR checks');
  }
  if (body.result === 'not_run') {
    throw invalid('an unticked check carries no evidence');
  }
  const own: readonly AdminField[] = FIELDS[kind];
  const stray = ADMIN_FIELDS.find(
    (field) => evidence[field] !== undefined && !own.includes(field),
  );
  if (stray) throw invalid(`${stray} does not belong to the ${kind} check`);
}

interface RegisterFacts {
  businessKind: BusinessKind | null;
  certificateUploaded: boolean;
  cui: string | null;
  rarNumber: string | null;
}

// A job of the garage's price list, as the activities check judges it.
type PricedJob = Awaited<ReturnType<typeof pricedJobs>>[number];

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
  const missing = CAEN_TICKS.filter(
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

// The RAR check: OK needs the file's number and every tick; the ticks are
// stored as sent, with the number the file held at the save.
function rarRecord(
  body: RecordVerificationCheckDto,
  facts: RegisterFacts,
): RegisterRecord {
  const ticks = {
    found: body.evidence?.found === true,
    sameAddress: body.evidence?.sameAddress === true,
    sameCompany: body.evidence?.sameCompany === true,
  };
  const evidence = {
    ...ticks,
    lookedUpOn: localDay(new Date()),
    rarNumber: facts.rarNumber,
  };
  if (body.result !== 'ok') return { evidence };
  const mobile = facts.businessKind === 'mobile';
  const missing = [
    ...(facts.rarNumber ? [] : [{ field: 'rarNumber', name: 'numărul RAR' }]),
    ...RAR_TICKS.filter((tick) => !ticks[tick]).map((tick) => ({
      field: `evidence.${tick}`,
      name: tickName(tick, mobile),
    })),
  ];
  if (missing.length) {
    throw invalid(
      `Lipsește: ${missing.map((m) => m.name).join(', ')}`,
      missing.map((m) => ({ code: 'required', field: m.field })),
    );
  }
  return { detail: mobile ? RAR_OK.seat : RAR_OK.premises, evidence };
}

// The activities check: the server finds the price-list jobs the list leaves
// uncovered; OK needs a list that covers every one.
function activitiesRecord(
  body: RecordVerificationCheckDto,
  activities: readonly string[],
  jobs: readonly PricedJob[],
): RegisterRecord {
  const uncovered = uncoveredJobs(jobs, activities);
  const evidence = {
    lookedUpOn: localDay(new Date()),
    uncoveredJobTypeIds: uncovered.map((j) => j.jobTypeId),
  };
  if (body.result !== 'ok') return { evidence };
  if (activities.length === 0) {
    throw invalid('Bifează cel puțin o activitate', [
      { code: 'required', field: 'activities' },
    ]);
  }
  if (uncovered.length) {
    throw invalid(
      `Nu sunt acoperite: ${uncovered.map((j) => j.nameRo).join(', ')}`,
      [{ code: 'uncovered', field: 'evidence.uncoveredJobTypeIds' }],
    );
  }
  return { detail: ACTIVITIES_OK, evidence };
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

// The detail as stored: trimmed, required for a problem and refused when
// the check is unticked. A register check's OK writes its own detail, so the
// one sent is not measured.
function detailOf(kind: string, body: RecordVerificationCheckDto) {
  const detail = body.detail?.trim() || null;
  const replaced = body.result === 'ok' && isRegister(kind);
  if (detail && !replaced && detail.length > CHECK_DETAIL_MAX) {
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
  const detail = detailOf(kind, body);
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
    const file = { ...(await this.file(tx, fileId)), id: fileId };
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

    const [before] = await tx.$queryRaw<
      Pick<VerificationCheck, 'id' | 'result' | 'detail' | 'evidence'>[]
    >`SELECT id, result::text AS result, detail, evidence FROM verification_check
      WHERE file_id = ${fileId}::uuid AND kind = ${kind}::verification_check_kind
      FOR UPDATE`;
    if (!before) throw new NotFoundException();
    const activities =
      kind === 'activities'
        ? await this.lists(tx, file.garageId, next.activities)
        : undefined;
    const register = await this.register(
      tx,
      kind,
      body,
      file,
      activities?.after ?? [],
    );
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
    if (next.activities) {
      await this.writeActivities(tx, file.garageId, next.activities);
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

    return this.answer(tx, fileId, file.garageId, check, actor.accountId);
  }

  // The garage's list as sent; it decides which of its jobs the public
  // profile lists.
  private async writeActivities(
    tx: Prisma.TransactionClient,
    garageId: string,
    activities: string[],
  ) {
    await tx.garage.update({
      data: { rarActivities: activities },
      where: { id: garageId },
    });
    await this.events.record(tx, {
      audience: { garageId, results: false, type: 'public_garage' },
      kind: 'price_list.updated',
      payload: {},
      subjectId: garageId,
    });
  }

  // The record call's answer: the check with its recorder, the garage's list
  // and the queue line, read inside the save.
  private async answer(
    tx: Prisma.TransactionClient,
    fileId: string,
    garageId: string,
    check: VerificationCheck,
    accountId: string,
  ) {
    const [checks, documents, garage] = await Promise.all([
      tx.verificationCheck.findMany({
        select: { detail: true, kind: true, result: true },
        where: { fileId },
      }),
      tx.legalDocument.findMany({
        select: { kind: true },
        where: { verificationFileId: fileId },
      }),
      tx.garage.findUniqueOrThrow({
        select: { rarActivities: true },
        where: { id: garageId },
      }),
    ]);
    const kinds = documents.map((d) => d.kind);
    return {
      check: {
        ...check,
        evidence: check.evidence as VerificationCheckEvidenceDto | null,
        recorder: await this.recorder(tx, accountId),
      },
      rarActivities: garage.rarActivities,
      summary: {
        en: checkSummary(checks, 'en', kinds),
        ro: checkSummary(checks, 'ro', kinds),
      },
    };
  }

  // Who saved it, as the file names a recorder, so the drawer shows it at once.
  private async recorder(tx: Prisma.TransactionClient, id: string) {
    const account = await tx.account.findUnique({
      select: { name: true },
      where: { id },
    });
    return { id, name: account ? firstName(account.name) : '' };
  }

  private async file(tx: Prisma.TransactionClient, id: string) {
    // PostgreSQL refuses a malformed uuid outright; it is an unknown id.
    if (!isUUID(id)) throw new NotFoundException();
    // Held until the save commits, so a decision racing it waits and the
    // record cannot land on a file decided meanwhile.
    const [file] = await tx.$queryRaw<
      {
        garageId: string;
        rarNumber: string | null;
        status: VerificationFileStatus;
      }[]
    >`SELECT garage_id AS "garageId", rar_number AS "rarNumber",
        status::text AS status
      FROM verification_file WHERE id = ${id}::uuid FOR SHARE`;
    if (!file) throw new NotFoundException();
    return file;
  }

  // A register check's record, unless it is cleared.
  private async register(
    tx: Prisma.TransactionClient,
    kind: VerificationCheckKind,
    body: RecordVerificationCheckDto,
    file: { garageId: string; id: string; rarNumber: string | null },
    activities: readonly string[],
  ): Promise<RegisterRecord | undefined> {
    if (!isRegister(kind) || body.result === 'not_run') return undefined;
    if (kind === 'activities') {
      return activitiesRecord(
        body,
        activities,
        await pricedJobs(tx, file.garageId),
      );
    }
    const facts = await this.facts(tx, file);
    if (kind === 'company') return companyRecord(body, facts);
    return kind === 'caen' ? caenRecord(body, facts) : rarRecord(body, facts);
  }

  // What the server reads itself for a register check: the garage's CUI and
  // kind, the file's RAR number and whether it holds an ONRC certificate.
  private async facts(
    tx: Prisma.TransactionClient,
    file: { garageId: string; id: string; rarNumber: string | null },
  ): Promise<RegisterFacts> {
    const fileId = file.id;
    const [garage, certificates] = await Promise.all([
      tx.garage.findUniqueOrThrow({
        select: { businessKind: true, cui: true },
        where: { id: file.garageId },
      }),
      tx.legalDocument.count({
        where: { kind: 'onrc_certificate', verificationFileId: fileId },
      }),
    ]);
    return {
      ...garage,
      certificateUploaded: certificates > 0,
      rarNumber: file.rarNumber,
    };
  }

  private async known(tx: Prisma.TransactionClient, codes: string[]) {
    const found = await tx.rarActivity.count({
      where: { code: { in: codes } },
    });
    if (found !== codes.length) throw invalid('unknown RAR activity code');
  }

  // The activities check's entry always carries the list, sent or kept.
  private async lists(
    tx: Prisma.TransactionClient,
    garageId: string,
    sent: string[] | undefined,
  ) {
    const before = await this.lockedActivities(tx, garageId);
    return { after: sent ?? before, before };
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
