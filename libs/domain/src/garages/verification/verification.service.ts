import {
  checkSummary,
  queueLamp,
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

type Transition = 'open' | 'decide' | 'resend' | 'reopen';

// The statuses each transition may start from; every other pair is refused.
const FROM: Record<Transition, VerificationFileStatus[]> = {
  decide: ['submitted', 'in_review'],
  open: ['submitted'],
  reopen: ['approved', 'rejected', 'more_requested'],
  resend: ['more_requested'],
};

const KIND: Record<Transition, string> = {
  decide: 'verification_decided',
  open: 'verification_opened',
  reopen: 'verification_reopened',
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
  async submit(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    garageId: string,
  ): Promise<VerificationFile> {
    const newest = await tx.verificationFile.findFirst({
      orderBy: newestFirst,
      where: { garageId },
    });
    if (newest && newest.status !== 'rejected') {
      throw await this.refusalFor(tx, newest);
    }
    const file = await tx.verificationFile
      .create({ data: { garageId, previousFileId: newest?.id ?? null } })
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
    if (approved && actor.role !== 'system') await this.gate(tx, fileId);
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
    if (approved) await this.publish(tx, actor, before, decidedAt);
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

  // An admin approves only a file whose RAR and CAEN checks are ok. The row
  // lock waits for a check being recorded, which holds the file row FOR
  // SHARE, so the gate reads what is true when the decision commits.
  private async gate(tx: Prisma.TransactionClient, fileId: string) {
    const [row] = await tx.$queryRaw<{ status: VerificationFileStatus }[]>`
      SELECT status FROM verification_file WHERE id = ${fileId}::uuid
      FOR UPDATE`;
    // A file no longer waiting is refused by the move, saying who decided.
    if (!row || !FROM.decide.includes(row.status)) return;
    const checks = await tx.verificationCheck.findMany({
      select: { kind: true, result: true },
      where: { fileId, kind: { in: ['rar', 'caen'] } },
    });
    for (const [kind, code, detail] of GATES) {
      if (
        checks.some((check) => check.kind === kind && check.result === 'ok')
      ) {
        continue;
      }
      countDecisionRefusal(code);
      this.logger.log(`file ${fileId} refused: ${code}`);
      throw refusal(HttpStatus.CONFLICT, code, detail);
    }
  }

  // One garage entry: the status, or approved_at when a reopened file of a
  // published garage is approved again.
  private async publish(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    before: Awaited<ReturnType<VerificationService['file']>>,
    decidedAt: Date,
  ) {
    const garage = await tx.garage.update({
      data: { approvedAt: decidedAt, status: 'approved' },
      select: { approvedAt: true, status: true },
      where: { id: before.garageId },
    });
    const again = before.garageStatus === garage.status;
    await this.audit.recordChanges(
      tx,
      {
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId: before.garageId,
        subjectId: before.garageId,
        subjectType: 'garage',
      },
      again
        ? { approvedAt: before.garageApprovedAt }
        : { status: before.garageStatus },
      again ? { approvedAt: garage.approvedAt } : { status: garage.status },
    );
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
      include: { garage: { select: { approvedAt: true, status: true } } },
      where: { id },
    });
    if (!file) throw new NotFoundException();
    const { garage, ...row } = file;
    return {
      ...row,
      garageApprovedAt: garage.approvedAt,
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
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'status',
      garageId: before.garageId,
      kind: KIND[transition],
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
  { checks, garage, id, status, submittedAt }: QueueFile,
  now: Date,
  holidays: ReadonlySet<string>,
): VerificationQueueRowDto {
  const workingDays = workingDaysWaited(submittedAt, now, holidays);
  const flagged = workingDays > VERIFICATION_TARGET_WORKING_DAYS;
  const area = garageArea(garage);
  const team = garage.features[0]?.enabled !== false;
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
    summary: { en: checkSummary(checks, 'en'), ro: checkSummary(checks, 'ro') },
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
    requestedItems: requestedItems ?? [],
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
