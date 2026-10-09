import { JOB_STEPS_MAX, type JobStepDto } from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  JobStep,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import type { JobStatus } from '../../generated/prisma/enums';
import {
  countJobStep,
  type JobStepAction,
} from '../../metrics/product-counters';

type Tx = Prisma.TransactionClient;

// The job as locked for one write, with the account of its mechanic.
interface LockedJob {
  id: string;
  garage_id: string;
  car_id: string;
  driver_id: string;
  mechanic_id: string | null;
  mechanic_account: string | null;
  status: JobStatus;
}

interface Written<T> {
  value: T;
  // Nothing was counted when nothing changed.
  action: JobStepAction | null;
}

const CLOSED: readonly JobStatus[] = ['done', 'cancelled'];
// Positions move out of the way first, so no two steps ever share one.
const ASIDE = 1000;

const stepOf = (step: JobStep): JobStepDto => ({
  customerLabel: step.customerLabel,
  doneAt: step.doneAt?.toISOString() ?? null,
  doneBy: step.doneById,
  id: step.id,
  label: step.label,
  position: step.position,
});

// Positions 1..n in the order given. It runs inside a write that audits it.
async function renumber(tx: Tx, jobId: string, ids: string[]) {
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE job_step SET position = position + ${ASIDE}
    WHERE job_id = ${jobId}::uuid`;
  await tx.$executeRaw`
    UPDATE job_step s SET position = o.n
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS o(id, n)
    WHERE s.id = o.id AND s.job_id = ${jobId}::uuid`;
}

// Who changed the steps, and on which job, car and garage.
const by = (actor: Actor, job: LockedJob) => ({
  actorId: actor.accountId,
  actorRole: actor.role,
  carId: job.car_id,
  garageId: job.garage_id,
  jobId: job.id,
});

// A job's steps, written by the owner or the job's own mechanic. Each write
// locks the job's row, so writes to one job run one after the other, and
// saves the change, its audit entry and its event together.
@Injectable()
export class JobStepsService {
  private readonly logger = new Logger('JobSteps');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  add(actor: Actor, jobId: string, key: string, text: string) {
    return this.write(actor, jobId, async (tx, job) => {
      const again = await tx.jobStep.findUnique({
        where: { jobId_idempotencyKey: { idempotencyKey: key, jobId } },
      });
      if (again) return { action: null, value: stepOf(again) };
      this.assertOpen(job);
      const steps = await tx.jobStep.findMany({
        orderBy: { position: 'asc' },
        where: { jobId },
      });
      if (steps.length >= JOB_STEPS_MAX) {
        throw this.refuse(job, null, 'too_many_steps', 'Cel mult 20 de pași');
      }
      const step = await tx.jobStep.create({
        data: {
          customerLabel: text,
          idempotencyKey: key,
          jobId,
          label: text,
          position: (steps.at(-1)?.position ?? 0) + 1,
        },
      });
      await this.audit.record(tx, {
        ...by(actor, job),
        action: 'create',
        field: 'label',
        newValue: text,
        subjectId: step.id,
        subjectType: 'job_step',
      });
      await this.changed(tx, job, 'added', step.id);
      return { action: 'added', value: stepOf(step) };
    });
  }

  rename(actor: Actor, jobId: string, stepId: string, text: string) {
    return this.write(actor, jobId, async (tx, job) => {
      this.assertOpen(job);
      const before = await this.step(tx, jobId, stepId);
      const step = await tx.jobStep.update({
        data: { customerLabel: text, label: text },
        where: { id: stepId },
      });
      await this.audit.record(tx, {
        ...by(actor, job),
        action: 'update',
        field: 'label',
        newValue: text,
        oldValue: before.label,
        subjectId: stepId,
        subjectType: 'job_step',
      });
      await this.changed(tx, job, 'renamed', stepId);
      return { action: 'renamed', value: stepOf(step) };
    });
  }

  reorder(actor: Actor, jobId: string, stepIds: string[]) {
    return this.write(actor, jobId, async (tx, job) => {
      this.assertOpen(job);
      const before = (
        await tx.jobStep.findMany({
          orderBy: { position: 'asc' },
          select: { id: true },
          where: { jobId },
        })
      ).map((s) => s.id);
      const named = new Set(stepIds);
      if (
        named.size !== stepIds.length ||
        stepIds.length !== before.length ||
        before.some((id) => !named.has(id))
      ) {
        throw refusal(
          HttpStatus.BAD_REQUEST,
          'validation_failed',
          'Name every step of the job once',
          [{ code: 'not_a_permutation', field: 'stepIds' }],
        );
      }
      await renumber(tx, jobId, stepIds);
      await this.audit.record(tx, {
        ...by(actor, job),
        action: 'update',
        field: 'steps_order',
        newValue: stepIds,
        oldValue: before,
        subjectId: jobId,
        subjectType: 'job',
      });
      await this.changed(tx, job, 'reordered');
      return { action: 'reordered', value: undefined };
    });
  }

  remove(actor: Actor, jobId: string, stepId: string) {
    return this.write(actor, jobId, async (tx, job) => {
      this.assertOpen(job);
      const step = await this.step(tx, jobId, stepId);
      await tx.jobStep.delete({ where: { id: stepId } });
      const rest = await tx.jobStep.findMany({
        orderBy: { position: 'asc' },
        select: { id: true },
        where: { jobId },
      });
      await renumber(
        tx,
        jobId,
        rest.map((s) => s.id),
      );
      await this.audit.record(tx, {
        ...by(actor, job),
        action: 'delete',
        field: 'label',
        oldValue: step.label,
        subjectId: stepId,
        subjectType: 'job_step',
      });
      await this.changed(tx, job, 'removed', stepId);
      return { action: 'removed', value: undefined };
    });
  }

  // Idempotent: a tick of a ticked step, or an untick of an open one, answers
  // the step as it is and records nothing.
  tick(actor: Actor, jobId: string, stepId: string, done: boolean) {
    return this.write(actor, jobId, async (tx, job) => {
      this.assertStarted(job, stepId);
      const before = await this.step(tx, jobId, stepId);
      if (Boolean(before.doneAt) === done) {
        return { action: null, value: stepOf(before) };
      }
      const turn = done
        ? { action: 'ticked' as const, at: new Date(), by: actor.accountId }
        : { action: 'unticked' as const, at: null, by: null };
      const step = await tx.jobStep.update({
        data: { doneAt: turn.at, doneById: turn.by },
        where: { id: stepId },
      });
      await this.audit.record(tx, {
        ...by(actor, job),
        action: 'update',
        field: 'done_at',
        newValue: turn.at,
        oldValue: before.doneAt,
        subjectId: stepId,
        subjectType: 'job_step',
      });
      await this.events.record(tx, {
        audience: this.audience(job),
        kind: done ? 'job.step_done' : 'job.step_undone',
        payload: { stepId },
        subjectId: jobId,
      });
      return { action: turn.action, value: stepOf(step) };
    });
  }

  // Locks the job, judges who may write it, runs the change and counts it
  // once the transaction has committed.
  private async write<T>(
    actor: Actor,
    jobId: string,
    change: (tx: Tx, job: LockedJob) => Promise<Written<T>>,
  ): Promise<T> {
    requireCapability(actor, 'garage.own_jobs');
    const { action, value } = await this.prisma.$transaction(async (tx) => {
      const job = await this.lock(tx, actor, jobId);
      return change(tx, job);
    });
    if (action) countJobStep(action);
    return value;
  }

  // Another garage's job, or none, does not exist for the caller; the
  // garage's own staff who may not write it are told no.
  private async lock(tx: Tx, actor: Actor, jobId: string): Promise<LockedJob> {
    const [job] = await tx.$queryRaw<LockedJob[]>`
      SELECT j.id, j.garage_id, j.car_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, j.status
      FROM job j LEFT JOIN mechanic m ON m.id = j.mechanic_id
      WHERE j.id = ${jobId}::uuid
      FOR UPDATE OF j`;
    if (!job || job.garage_id !== actor.garageId) throw new NotFoundException();
    const trusted =
      actor.role === 'garage' ||
      (actor.role === 'mechanic' && job.mechanic_account === actor.accountId);
    if (!trusted) {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        "Only the owner and the job's mechanic write its steps",
      );
    }
    return job;
  }

  private assertOpen(job: LockedJob) {
    if (CLOSED.includes(job.status)) {
      throw this.refuse(job, null, 'job_closed', 'The job is closed');
    }
  }

  // A step is ticked only once the work has started.
  private assertStarted(job: LockedJob, stepId: string) {
    this.assertOpen(job);
    if (job.status === 'to_do') {
      throw this.refuse(
        job,
        stepId,
        'job_not_started',
        'Pornește lucrarea mai întâi',
      );
    }
  }

  private async step(tx: Tx, jobId: string, stepId: string) {
    const step = await tx.jobStep.findFirst({ where: { id: stepId, jobId } });
    if (!step) throw new NotFoundException();
    return step;
  }

  // The refusal's log line carries ids and the code, never the step's words.
  private refuse(
    job: LockedJob,
    stepId: string | null,
    code: string,
    message: string,
  ) {
    this.logger.warn(
      `job step refused: ${code} job=${job.id}${stepId ? ` step=${stepId}` : ''}`,
    );
    return refusal(HttpStatus.CONFLICT, code, message);
  }

  private changed(
    tx: Tx,
    job: LockedJob,
    action: 'added' | 'renamed' | 'reordered' | 'removed',
    stepId?: string,
  ) {
    return this.events.record(tx, {
      audience: this.audience(job),
      kind: 'job.steps_changed',
      payload: stepId ? { action, stepId } : { action },
      subjectId: job.id,
    });
  }

  private audience(job: LockedJob) {
    return {
      driverAccountId: job.driver_id,
      garageId: job.garage_id,
      mechanicId: job.mechanic_id,
      type: 'job' as const,
    };
  }
}
