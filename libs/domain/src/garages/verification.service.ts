import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  VERIFICATION_CONFIG,
  type VerificationConfig,
} from './verification-config';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { firstName } from '../audit/audit.service';
import { type Actor, requireCapability } from '../auth/policy';
import { refusal, taken } from '../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type {
  Prisma,
  VerificationFile,
  VerificationFileStatus,
} from '../generated/prisma/client';

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

const SYSTEM = { accountId: null, role: 'system' } as const;

const newestFirst = [
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
    if (before.status !== 'in_review') {
      const openedAt = new Date();
      const file = await this.move(tx, actor, before, 'open', {
        openedAt,
        openedBy: actor.accountId,
        status: 'in_review',
      });
      await this.announce(tx, file, 'verification.opened');
      return { byAnother: false, openedAt, openedBy: actor.accountId };
    }
    return {
      byAnother: before.openedBy !== actor.accountId,
      openedAt: before.openedAt,
      openedBy: before.openedBy,
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
    const before = await this.file(tx, fileId);
    const decidedAt = new Date();
    const reason = decision.outcome === 'approved' ? null : decision.reason;
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
    if (decision.outcome === 'approved') {
      const garage = await tx.garage.update({
        data: { approvedAt: decidedAt, status: 'approved' },
        select: { status: true },
        where: { id: file.garageId },
      });
      await this.audit.recordChanges(
        tx,
        {
          actorId: actor.accountId,
          actorRole: actor.role,
          garageId: file.garageId,
          subjectId: file.garageId,
          subjectType: 'garage',
        },
        { status: before.garageStatus },
        { status: garage.status },
      );
    }
    await this.announce(tx, file, 'verification.decided', {
      decision: decision.outcome,
    });
    return file;
  }

  async resend(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
  ): Promise<VerificationFile> {
    const before = await this.file(tx, fileId);
    const file = await this.move(tx, actor, before, 'resend', {
      status: 'submitted',
    });
    await this.announce(tx, file, 'verification.submitted');
    return file;
  }

  // Only the garage's newest file, and only while no other file is live.
  async reopen(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    fileId: string,
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
    const file = await this.move(tx, actor, before, 'reopen', {
      reopenedAt: new Date(),
      reopenedBy: actor.accountId,
      status: 'in_review',
    }).catch((error: unknown) => {
      // Another file of the garage went live meanwhile.
      throw taken(error) ? refused('another file is under way') : error;
    });
    await this.announce(tx, file, 'verification.reopened');
    return file;
  }

  private async file(tx: Prisma.TransactionClient, id: string) {
    const file = await tx.verificationFile.findUnique({
      include: { garage: { select: { status: true } } },
      where: { id },
    });
    if (!file) throw new NotFoundException();
    const { garage, ...row } = file;
    return { ...row, garageStatus: garage.status };
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
    extra: { decision?: Decision['outcome'] } = {},
  ) {
    const published = extra.decision === 'approved';
    return this.events.record(tx, {
      audience: {
        garageId: file.garageId,
        // No garage has brands yet, so an approval reaches no search.
        ...(published && { published: { brandIds: [] } }),
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

async function name(tx: Prisma.TransactionClient, accountId: string | null) {
  if (!accountId) return 'MotorFix';
  const account = await tx.account.findUnique({
    select: { name: true },
    where: { id: accountId },
  });
  return firstName(account?.name ?? '');
}
