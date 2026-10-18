import {
  type ApprovalGap,
  approvalGaps,
  checkSummary,
  normaliseRarNumber,
  queueLamp,
  rarNumberRefused,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_TARGET_WORKING_DAYS,
  type VerificationQueueAreaDto,
  type VerificationQueueDto,
  type VerificationQueueRowDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  VERIFICATION_CONFIG,
  type VerificationConfig,
} from './verification-config';
import { workingDaysWaited } from './working-days';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { firstName } from '../../audit/audit.service';
import { type Actor, requireCapability } from '../../auth/policy';
import { refusal, taken } from '../../auth/sign-up.service';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  Prisma,
  VerificationFile,
  VerificationFileStatus,
  VerificationReopenReason,
} from '../../generated/prisma/client';
import {
  countApproval,
  countDecisionRefusal,
  countReopening,
} from '../../metrics/product-counters';

export type VerificationActor = Actor | { accountId: null; role: 'system' };

// The endpoint's body as the use case takes it; the edge has checked each
// value, the use case the rules between them.
export type Decision = {
  outcome: 'approved' | 'more_requested' | 'rejected';
  reason?: string;
  note?: string;
  requestedItems?: string[];
};

type Transition = 'open' | 'decide' | 'resend' | 'reopen' | 'reports';

// The statuses each transition may start from; every other pair is refused.
const FROM: Record<Transition, VerificationFileStatus[]> = {
  decide: ['submitted', 'in_review'],
  open: ['submitted'],
  reopen: ['approved', 'rejected', 'more_requested'],
  // A file a report reopened goes back to approved with the reports' decision.
  reports: ['in_review'],
  resend: ['more_requested'],
};

// The file's history entry for each move; a decision on the reports writes
// its own, which names the reports, so the move adds none.
const KIND: Record<Transition, string | null> = {
  decide: 'verification_decided',
  open: 'verification_opened',
  reopen: 'verification_reopened',
  reports: null,
  resend: 'verification_resent',
};

const LIVE: VerificationFileStatus[] = ['submitted', 'in_review', 'approved'];

// Waiting for an admin; a file asked for more waits for its garage.
const WAITING: VerificationFileStatus[] = ['submitted', 'in_review'];

export const SYSTEM = { accountId: null, role: 'system' } as const;

export const newestFirst = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.VerificationFileOrderByWithRelationInput[];

const refused = (detail: string) =>
  refusal(HttpStatus.CONFLICT, 'verification_transition_refused', detail);

// The checks an admin's approval waits for, in the order they are asked.
const GATES = [
  ['rar', 'rar_check_required', 'the rar check is not ok'],
  ['caen', 'caen_check_required', 'the caen check is not ok'],
] as const;

// A garage's verification file and its moves. Each use case runs in the
// caller's transaction, so a story that creates the garage can submit in the
// same commit; a move, its history entry and its event commit together.
@Injectable()
export class VerificationService {
  private readonly logger = new Logger('Verification');

  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(VERIFICATION_CONFIG) private readonly config: VerificationConfig,
  ) {}

  // Every garage on the platform, or only those placed in one city.
  countWaiting(
    db: Prisma.TransactionClient,
    cityKey?: string,
  ): Promise<number> {
    return db.verificationFile.count({
      where: {
        status: { in: WAITING },
        ...(cityKey !== undefined && { garage: { cityKey } }),
      },
    });
  }

  // The admins' queue, oldest sending first; `total` is the waiting count
  // the overview, the menu and the header show.
  async queue(
    db: Prisma.TransactionClient,
    { limit, offset }: { limit: number; offset: number },
    now: Date,
  ): Promise<VerificationQueueDto> {
    const [files, total] = await Promise.all([
      db.verificationFile.findMany({
        orderBy: [{ submittedAt: 'asc' }, { id: 'desc' }],
        select: {
          checks: { select: { detail: true, kind: true, result: true } },
          documents: { select: { kind: true } },
          garage: { select: QUEUE_GARAGE },
          id: true,
          status: true,
          submittedAt: true,
        },
        skip: offset,
        take: limit,
        where: { status: { in: WAITING } },
      }),
      this.countWaiting(db),
    ]);
    const holidays = files.length
      ? await db.publicHoliday.findMany({
          select: { day: true },
          where: {
            day: {
              gte: new Date(localDay(files[0].submittedAt)),
              lte: new Date(localDay(now)),
            },
          },
        })
      : [];
    const days = new Set(holidays.map(({ day }) => isoDay(day)));
    return { items: files.map((file) => queueRow(file, now, days)), total };
  }

  // Who may submit is the submitting story's rule; here only the files count.
  // The RAR number, when given, is stored as step 6 normalises it.
  async submit(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    garageId: string,
    rarNumber?: string,
  ): Promise<VerificationFile> {
    if (rarNumber && rarNumberRefused(rarNumber)) throw rarNumberInvalid();
    const newest = await tx.verificationFile.findFirst({
      orderBy: newestFirst,
      where: { garageId },
    });
    if (newest && newest.status !== 'rejected') {
      throw await this.refusalFor(tx, newest);
    }
    const file = await tx.verificationFile
      .create({
        data: {
          garageId,
          previousFileId: newest?.id ?? null,
          rarNumber: rarNumber ? normaliseRarNumber(rarNumber) : null,
        },
      })
      .catch((error: unknown) => {
        // A submission that raced this one committed first.
        throw taken(error)
          ? refused('already sent, waiting for review')
          : error;
      });
    await this.audit.record(tx, {
      action: 'create',
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      newValue: 'submitted',
      subjectId: file.id,
      subjectType: 'verification_file',
    });
    await withChecks(tx, file.id);
    await this.announce(tx, file, 'verification.submitted');
    if (!this.config.skipManualApproval) return file;
    return this.decide(tx, SYSTEM, file.id, { outcome: 'approved' });
  }

  // An admin sets or corrects the file's RAR number while it is undecided:
  // one history entry, no event, and the garage is not told.
  async correctRarNumber(
    tx: Prisma.TransactionClient,
    actor: Actor,
    fileId: string,
    input: string,
  ): Promise<void> {
    requireCapability(actor, 'admin.garages');
    if (!isUUID(fileId)) throw new NotFoundException();
    if (rarNumberRefused(input)) throw rarNumberInvalid();
    const rarNumber = normaliseRarNumber(input);
    // Held until the correction commits, so two corrections serialise and a
    // decision racing it waits.
    const [file] = await tx.$queryRaw<
      {
        garageId: string;
        rarNumber: string | null;
        status: VerificationFileStatus;
      }[]
    >`SELECT garage_id AS "garageId", rar_number AS "rarNumber",
        status::text AS status
      FROM verification_file WHERE id = ${fileId}::uuid FOR UPDATE`;
    if (!file) throw new NotFoundException();
    // A decided file is the one a reopening starts from.
    if (FROM.reopen.includes(file.status)) {
      throw refusal(
        HttpStatus.CONFLICT,
        'verification_file_decided',
        'Dosarul e deja decis',
      );
    }
    if (file.rarNumber === rarNumber) return;
    await tx.verificationFile.update({
      data: { rarNumber },
      where: { id: fileId },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'rar_number',
      garageId: file.garageId,
      newValue: rarNumber,
      oldValue: file.rarNumber,
      subjectId: fileId,
      subjectType: 'verification_file',
    });
    this.logger.log(
      `file ${fileId} RAR number corrected by ${actor.accountId}`,
    );
  }

  // A second admin's open changes nothing and says who opened it first.
  async open(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
  ) {
    trust(actor);
    const before = await this.file(tx, fileId);
    // Only a waiting file moves; any other is answered as it stands, so a
    // decided file opens read-only.
    if (before.status !== 'submitted') return openedFirst(actor, before);
    const openedAt = new Date();
    let file: VerificationFile;
    try {
      file = await this.move(tx, actor, before, 'open', {
        openedAt,
        openedBy: actor.accountId,
        status: 'in_review',
      });
    } catch (error) {
      // A racing open committed first: answer with it, unchanged.
      const after = await this.file(tx, fileId);
      if (after.status === 'in_review') return openedFirst(actor, after);
      throw error;
    }
    await this.announce(tx, file, 'verification.opened');
    return {
      byAnother: false,
      first: true,
      openedAt,
      openedBy: actor.accountId,
    };
  }

  // An approval publishes the garage, a reopened file's included; any other
  // outcome leaves the garage as it is.
  async decide(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
    decision: Decision,
  ): Promise<VerificationFile> {
    trust(actor);
    const { note, reason, requestedItems } = payloadOf(decision);
    const approved = decision.outcome === 'approved';
    const before = await this.file(tx, fileId);
    // Suspension and its lifting belong to the suspension story alone.
    if (approved && before.garageStatus === 'suspended') {
      throw refused('the garage is suspended');
    }
    const missing = approved
      ? await this.judge(tx, actor, fileId, note)
      : undefined;
    const decidedAt = new Date();
    const file = await this.move(
      tx,
      actor,
      before,
      'decide',
      {
        decidedAt,
        decidedBy: actor.accountId,
        reasonCode: reason,
        reasonNote: note,
        requestedItems,
        status: decision.outcome,
      },
      reason && note ? `${reason}: ${note}` : (note ?? undefined),
    ).catch((error: unknown) => {
      if (decidedAlready(error)) {
        countDecisionRefusal('already_decided');
        this.logger.log(`file ${fileId} refused: already_decided`);
      }
      throw error;
    });
    if (missing) await this.publish(tx, actor, before, decidedAt, missing);
    await this.announce(tx, file, 'verification.decided', {
      decision: decision.outcome,
      note,
      reason,
    });
    // A request for more documents is not a verdict.
    if (decision.outcome !== 'more_requested') countApproval(decision.outcome);
    this.logger.log(
      `file ${fileId} ${decision.outcome} by ${actor.accountId ?? 'system'}`,
    );
    return file;
  }

  // An approval's checks, read once: an admin's must pass the RAR and CAEN
  // gates, then carry a note when it passes over a guide check not ok or a
  // missing document; the system's passes neither but its list is recorded.
  // The row lock waits for a check being recorded, which holds the file row
  // FOR SHARE, so the rules read what is true when the decision commits.
  private async judge(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
    note: string | null,
  ): Promise<ApprovalGap[]> {
    const [row] = await tx.$queryRaw<{ status: VerificationFileStatus }[]>`
      SELECT status FROM verification_file WHERE id = ${fileId}::uuid
      FOR UPDATE`;
    const [checks, documents] = await Promise.all([
      tx.verificationCheck.findMany({
        select: { kind: true, result: true },
        where: { fileId },
      }),
      tx.legalDocument.findMany({
        select: { kind: true },
        where: { verificationFileId: fileId },
      }),
    ]);
    const missing = approvalGaps(
      checks,
      documents.map((document) => document.kind),
    );
    // A file no longer waiting is refused by the move, saying who decided.
    if (actor.role === 'system' || !row || !FROM.decide.includes(row.status)) {
      return missing;
    }
    const skipRar = await this.skipRar(tx);
    for (const [kind, code, detail] of GATES) {
      if (
        (kind === 'rar' && skipRar) ||
        checks.some((check) => check.kind === kind && check.result === 'ok')
      ) {
        continue;
      }
      this.refuse(fileId, code);
      throw refusal(HttpStatus.CONFLICT, code, detail);
    }
    if (missing.length && !note) {
      this.refuse(fileId, 'note_required');
      throw new HttpException(
        {
          code: 'note_required',
          errors: [{ code: 'required', field: 'note' }],
          message: 'An approval past a check not ok needs a note',
          missing,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return missing;
  }

  // The test-only switch, read per decision and never in production.
  private async skipRar(tx: Prisma.TransactionClient) {
    if (!this.config.testRules) return false;
    const rule = await tx.platformRule.findUnique({
      select: { value: true },
      where: { key: 'skip_rar_check' },
    });
    return rule?.value === true;
  }

  private refuse(
    fileId: string,
    code: Parameters<typeof countDecisionRefusal>[0],
  ) {
    countDecisionRefusal(code);
    this.logger.log(`file ${fileId} refused: ${code}`);
  }

  // The garage's entries: the status, or approved_at when a reopened file of
  // a published garage is approved again; the Bucharest day of the check;
  // and what the approval passed over.
  private async publish(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    before: Awaited<ReturnType<VerificationService['file']>>,
    decidedAt: Date,
    missing: ApprovalGap[],
  ) {
    const day = localDay(decidedAt);
    const garage = await tx.garage.update({
      data: {
        approvedAt: decidedAt,
        lastCheckedOn: new Date(day),
        status: 'approved',
      },
      select: { approvedAt: true, status: true },
      where: { id: before.garageId },
    });
    const again = before.garageStatus === garage.status;
    const checkedBefore =
      before.garageLastCheckedOn?.toISOString().slice(0, 10) ?? null;
    await this.audit.recordChanges(
      tx,
      {
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId: before.garageId,
        subjectId: before.garageId,
        subjectType: 'garage',
      },
      {
        ...(again
          ? { approvedAt: before.garageApprovedAt }
          : { status: before.garageStatus }),
        lastCheckedOn: checkedBefore,
      },
      {
        ...(again
          ? { approvedAt: garage.approvedAt }
          : { status: garage.status }),
        lastCheckedOn: day,
        verificationMissing: missing,
      },
    );
  }

  // The file's move when its reports are decided: the garage stays as it is,
  // so no gate and no publication; the reports' story announces it. A file
  // in review with no open report is an ordinary review, refused as one.
  async approveAfterReports(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
  ): Promise<VerificationFile> {
    trust(actor);
    const before = await this.file(tx, fileId);
    if (before.status === 'in_review') {
      const open = await tx.garageReport.count({
        where: { status: 'open', verificationFileId: fileId },
      });
      if (open === 0) {
        this.refuse(fileId, 'no_open_report');
        throw await this.refusalFor(tx, before);
      }
    }
    return this.move(tx, actor, before, 'reports', {
      decidedAt: new Date(),
      decidedBy: actor.accountId,
      status: 'approved',
    }).catch((error: unknown) => {
      if (decidedAlready(error)) this.refuse(fileId, 'already_decided');
      throw error;
    });
  }

  // Who may resend is the submitting story's rule; here only the file counts.
  async resend(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
  ): Promise<VerificationFile> {
    const before = await this.file(tx, fileId);
    const file = await this.move(tx, actor, before, 'resend', {
      status: 'submitted',
      submittedAt: new Date(),
    });
    await withChecks(tx, file.id);
    await this.announce(tx, file, 'verification.submitted');
    return file;
  }

  // Only the garage's newest file, and only while no other file is live.
  async reopen(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
    reason?: VerificationReopenReason,
  ): Promise<VerificationFile> {
    trust(actor);
    const before = await this.file(tx, fileId);
    const blocking = await tx.verificationFile.findFirst({
      orderBy: newestFirst,
      where: {
        garageId: before.garageId,
        id: { not: fileId },
        OR: [{ status: { in: LIVE } }, { createdAt: { gt: before.createdAt } }],
      },
    });
    if (blocking) throw await this.refusalFor(tx, blocking);
    const file = await this.move(
      tx,
      actor,
      before,
      'reopen',
      {
        reopenedAt: new Date(),
        reopenedBy: actor.accountId,
        reopenReason: reason ?? null,
        status: 'in_review',
        submittedAt: new Date(),
      },
      reason,
    ).catch((error: unknown) => {
      // Another file of the garage went live meanwhile.
      throw taken(error) ? refused('another file is under way') : error;
    });
    await this.announce(tx, file, 'verification.reopened', {
      adminId: actor.accountId,
      ...(reason && { reason }),
    });
    countReopening(actor.role === 'system' ? 'system' : 'admin');
    this.logger.log(
      `file ${fileId} reopened by ${actor.accountId ?? 'system'}`,
    );
    return file;
  }

  private async file(tx: Prisma.TransactionClient, id: string) {
    // PostgreSQL refuses a malformed uuid outright; it is an unknown id.
    if (!isUUID(id)) throw new NotFoundException();
    const file = await tx.verificationFile.findUnique({
      include: {
        garage: {
          select: { approvedAt: true, lastCheckedOn: true, status: true },
        },
      },
      where: { id },
    });
    if (!file) throw new NotFoundException();
    const { garage, ...row } = file;
    return {
      ...row,
      garageApprovedAt: garage.approvedAt,
      garageLastCheckedOn: garage.lastCheckedOn,
      garageStatus: garage.status,
    };
  }

  // Compare and set on the status read: a concurrent move commits first and
  // this one, after waiting on the row lock, updates nothing and is refused
  // with what the winner wrote.
  private async move(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    before: VerificationFile,
    transition: Transition,
    data: Prisma.VerificationFileUpdateManyMutationInput & {
      status: VerificationFileStatus;
    },
    text?: string,
  ): Promise<VerificationFile> {
    const allowed = FROM[transition].includes(before.status);
    const { count } = allowed
      ? await tx.verificationFile.updateMany({
          data,
          where: { id: before.id, status: before.status },
        })
      : { count: 0 };
    const after = await tx.verificationFile.findUniqueOrThrow({
      where: { id: before.id },
    });
    if (count === 0) throw await this.refusalFor(tx, after);
    const kind = KIND[transition];
    if (kind)
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId: before.garageId,
        kind,
        newValue: data.status,
        oldValue: before.status,
        subjectId: before.id,
        subjectType: 'verification_file',
        text,
      });
    return after;
  }

  private announce(
    tx: Prisma.TransactionClient,
    file: VerificationFile,
    kind:
      | 'verification.submitted'
      | 'verification.opened'
      | 'verification.decided'
      | 'verification.reopened',
    extra: {
      decision?: Decision['outcome'];
      reason?: string | null;
      note?: string | null;
      adminId?: string | null;
    } = {},
  ) {
    const published = extra.decision === 'approved';
    return this.events.record(tx, {
      audience: {
        garageId: file.garageId,
        ...(published && { published: true as const }),
        type: 'verification',
      },
      kind,
      payload: { fileId: file.id, garageId: file.garageId, ...extra },
      subjectId: file.id,
    });
  }

  // The file's status and who set it, read after the refusal.
  private async refusalFor(
    tx: Prisma.TransactionClient,
    file: VerificationFile,
  ) {
    if (file.status === 'submitted') {
      return refused('already sent, waiting for review');
    }
    if (file.status === 'in_review') {
      const reopened =
        file.reopenedAt && (!file.openedAt || file.reopenedAt > file.openedAt);
      const by = reopened ? file.reopenedBy : file.openedBy;
      return refused(`already under review, opened by ${await name(tx, by)}`);
    }
    const decidedBy = await name(tx, file.decidedBy);
    const decidedAt = file.decidedAt?.toISOString() ?? '';
    return new HttpException(
      {
        code: 'verification_transition_refused',
        currentStatus: file.status,
        decidedAt,
        decidedBy,
        entity: 'verification_file',
        message: `already decided by ${decidedBy} at ${decidedAt}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

// Opening, deciding and reopening are the admins' and the system's alone.
function trust(actor: VerificationActor) {
  if (actor.role !== 'system') requireCapability(actor, 'admin.garages');
}

const QUEUE_GARAGE = {
  _count: {
    select: { brands: { where: { stance: 'works_on' } }, mechanics: true },
  },
  businessKind: true,
  cityName: true,
  features: { select: { enabled: true }, where: { key: 'team_mechanics' } },
  id: true,
  name: true,
  serviceRadiusKm: true,
} satisfies Prisma.GarageSelect;

type QueueFile = Prisma.VerificationFileGetPayload<{
  select: {
    checks: { select: { detail: true; kind: true; result: true } };
    documents: { select: { kind: true } };
    garage: { select: typeof QUEUE_GARAGE };
    id: true;
    status: true;
    submittedAt: true;
  };
}>;

// Where a garage works: a mobile mechanic's radius, else its town.
export function garageArea(garage: {
  businessKind: string | null;
  cityName: string | null;
  serviceRadiusKm: number | null;
}): VerificationQueueAreaDto | undefined {
  if (garage.businessKind === 'mobile' && garage.serviceRadiusKm !== null)
    return { kind: 'mobile', radiusKm: garage.serviceRadiusKm };
  return garage.cityName ? { kind: 'town', name: garage.cityName } : undefined;
}

const isoDay = (day: Date) => day.toISOString().slice(0, 10);

function queueRow(
  { checks, documents, garage, id, status, submittedAt }: QueueFile,
  now: Date,
  holidays: ReadonlySet<string>,
): VerificationQueueRowDto {
  const workingDays = workingDaysWaited(submittedAt, now, holidays);
  const flagged = workingDays > VERIFICATION_TARGET_WORKING_DAYS;
  const area = garageArea(garage);
  const team = garage.features[0]?.enabled !== false;
  const kinds = documents.map((d) => d.kind);
  return {
    ...(area && { area }),
    brands: garage._count.brands,
    flagged,
    garageId: garage.id,
    garageName: garage.name,
    id,
    lamp: queueLamp(checks, flagged),
    ...(team && { mechanics: garage._count.mechanics }),
    status: status as VerificationQueueRowDto['status'],
    submittedAt,
    summary: {
      en: checkSummary(checks, 'en', kinds),
      ro: checkSummary(checks, 'ro', kinds),
    },
    workingDays,
  };
}

// One check per kind, not run; a check the file already has keeps its result.
// The submission's history entry covers them.
const withChecks = (tx: Prisma.TransactionClient, fileId: string) =>
  tx.verificationCheck.createMany({
    data: VERIFICATION_CHECK_KINDS.map((kind) => ({ fileId, kind })),
    skipDuplicates: true,
  });

async function name(tx: Prisma.TransactionClient, accountId: string | null) {
  if (!accountId) return 'MotorFix';
  const account = await tx.account.findUnique({
    select: { name: true },
    where: { id: accountId },
  });
  return account ? firstName(account.name) : 'someone';
}

// The rules between the payload's values: a rejection names a reason, a
// rejection and a request for more carry a note, an approval's blank note is
// none. A reason or items where the decision has no use for them is a
// malformed body, as the edge would answer it.
function payloadOf(decision: Decision) {
  wellFormed(decision);
  const { note, outcome, reason, requestedItems } = decision;
  const text = note?.trim() || null;
  if (outcome === 'rejected' && !reason?.trim()) {
    throw required('reason_required', 'A rejection needs a reason', 'reason');
  }
  if (outcome !== 'approved' && !text) {
    throw required('note_required', 'This decision needs a note', 'note');
  }
  return {
    note: text,
    reason: reason ?? null,
    // An item listed twice is asked for once.
    requestedItems: [...new Set(requestedItems ?? [])],
  };
}

function wellFormed({ outcome, reason, requestedItems }: Decision) {
  if (outcome === 'approved' && reason !== undefined) {
    throw malformed('An approval carries no reason');
  }
  if (outcome !== 'more_requested' && requestedItems !== undefined) {
    throw malformed('Only a request for more lists what is missing');
  }
}

const malformed = (detail: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', detail);

const required = (code: string, detail: string, field: string) =>
  refusal(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [
    { code: 'required', field },
  ]);

// The move's refusal of a file someone decided first.
const decidedAlready = (error: unknown) =>
  error instanceof HttpException &&
  (error.getResponse() as { decidedBy?: unknown }).decidedBy !== undefined;

// An open that moved nothing: the file was opened before, by this admin or another.
function openedFirst(actor: VerificationActor, file: VerificationFile) {
  return {
    byAnother: file.openedBy !== actor.accountId,
    first: false,
    openedAt: file.openedAt,
    openedBy: file.openedBy,
  };
}

// The same refusal for a correction and a submission.
function rarNumberInvalid() {
  return refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    'Numărul RAR: între 3 și 40 de caractere, fără caractere de control',
    [{ code: 'invalid', field: 'rarNumber' }],
  );
}
