import { VERIFICATION_CHECK_KINDS } from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  VERIFICATION_CONFIG,
  type VerificationConfig,
} from './verification-config';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { firstName } from '../../audit/audit.service';
import { type Actor, requireCapability } from '../../auth/policy';
import { refusal, taken } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  Prisma,
  VerificationFile,
  VerificationFileStatus,
  VerificationReopenReason,
} from '../../generated/prisma/client';
import { countApproval } from '../../metrics/product-counters';

export type VerificationActor = Actor | { accountId: null; role: 'system' };

export type Decision =
  | { outcome: 'approved' }
  | {
      outcome: 'more_requested' | 'rejected';
      reason: { code: string; note: string };
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

export const SYSTEM = { accountId: null, role: 'system' } as const;

export const newestFirst = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.VerificationFileOrderByWithRelationInput[];

const refused = (detail: string) =>
  refusal(HttpStatus.CONFLICT, 'verification_transition_refused', detail);

// A garage's verification file and its moves. Each use case runs in the
// caller's transaction, so a story that creates the garage can submit in the
// same commit; a move, its history entry and its event commit together.
@Injectable()
export class VerificationService {
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
        status: { in: ['submitted', 'in_review'] },
        ...(cityKey !== undefined && { garage: { cityKey } }),
      },
    });
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
    if (before.status === 'in_review') return openedFirst(actor, before);
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
    return { byAnother: false, openedAt, openedBy: actor.accountId };
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
    const reason = reasonOf(decision);
    const before = await this.file(tx, fileId);
    // Suspension and its lifting belong to the suspension story alone.
    if (!reason && before.garageStatus === 'suspended') {
      throw refused('the garage is suspended');
    }
    const decidedAt = new Date();
    const file = await this.move(
      tx,
      actor,
      before,
      'decide',
      {
        decidedAt,
        decidedBy: actor.accountId,
        reasonCode: reason?.code ?? null,
        reasonNote: reason?.note ?? null,
        status: decision.outcome,
      },
      reason ? `${reason.code}: ${reason.note}` : undefined,
    );
    if (!reason) await this.publish(tx, actor, before, decidedAt);
    await this.announce(tx, file, 'verification.decided', {
      decision: decision.outcome,
    });
    // A request for more documents is not a verdict.
    if (decision.outcome !== 'more_requested') countApproval(decision.outcome);
    return file;
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
      },
      reason,
    ).catch((error: unknown) => {
      // Another file of the garage went live meanwhile.
      throw taken(error) ? refused('another file is under way') : error;
    });
    await this.announce(
      tx,
      file,
      'verification.reopened',
      reason ? { reason } : {},
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
      reason?: VerificationReopenReason;
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
    return refused(
      `already decided by ${await name(tx, file.decidedBy)} (${file.status})`,
    );
  }
}

// Opening, deciding and reopening are the admins' and the system's alone.
function trust(actor: VerificationActor) {
  if (actor.role !== 'system') requireCapability(actor, 'admin.garages');
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

// A negative outcome's reason, required with a code and a note.
function reasonOf(decision: Decision) {
  if (decision.outcome === 'approved') return null;
  const { code, note } = decision.reason;
  if (!code.trim() || !note.trim()) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'A reason needs a code and a note',
    );
  }
  return decision.reason;
}

function openedFirst(actor: VerificationActor, file: VerificationFile) {
  return {
    byAnother: file.openedBy !== actor.accountId,
    openedAt: file.openedAt,
    openedBy: file.openedBy,
  };
}
