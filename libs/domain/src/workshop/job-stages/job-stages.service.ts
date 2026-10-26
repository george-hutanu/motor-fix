import type { EventKind, JobDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import { featureOn } from '../../garages/features/feature-on';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { JobStatus } from '../../generated/prisma/enums';
import {
  countJobStageMove,
  type JobStageAction,
} from '../../metrics/product-counters';
import { moveRequest } from '../../quotes/transitions';
import { invalidTransition, type TransitionActor } from '../../transitions';
import { GarageJobsService } from '../garage-jobs/garage-jobs.service';
import { moveJob } from '../transitions';

type Tx = Prisma.TransactionClient;
type Verb = Exclude<JobStageAction, 'receive'>;

// The job as locked for one move, with its mechanic's account and its request.
interface LockedJob {
  id: string;
  garage_id: string;
  car_id: string;
  driver_id: string;
  mechanic_id: string | null;
  mechanic_account: string | null;
  request_id: string;
  status: JobStatus;
  received_at: Date | null;
  odometer_km: number | null;
}

// Each verb's stages it starts from, where it goes, what it is called and
// where the request goes with it: into work at the start, done at the end.
const VERBS: Record<
  Verb,
  {
    from: readonly JobStatus[];
    to: JobStatus;
    kind: EventKind;
    request?: 'in_work' | 'done';
  }
> = {
  finish: {
    from: ['in_work', 'paused'],
    kind: 'job.done',
    request: 'done',
    to: 'done',
  },
  pause: { from: ['in_work'], kind: 'job.paused', to: 'paused' },
  resume: { from: ['paused'], kind: 'job.resumed', to: 'in_work' },
  start: {
    from: ['to_do'],
    kind: 'job.started',
    request: 'in_work',
    to: 'in_work',
  },
};

// Today in Bucharest, as a reading's day is stored.
const today = () => new Date(`${localDay(new Date())}T00:00:00Z`);

const CLOSED: readonly JobStatus[] = ['done', 'cancelled'];
const SYSTEM: TransitionActor = { accountId: null, role: 'system' };
const TEAM = 'team_mechanics';

const audience = (job: LockedJob) => ({
  driverAccountId: job.driver_id,
  garageId: job.garage_id,
  mechanicId: job.mechanic_id,
  type: 'job' as const,
});

// A booked job's stages, moved by the owner or the job's own mechanic, and
// its reception, recorded by them or the desk. Each call locks the job's row,
// so calls on one job run one after the other, and writes the move, the
// request's move, the audit entries and the events together.
@Injectable()
export class JobStagesService {
  private readonly logger = new Logger('JobStages');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly jobs: GarageJobsService,
  ) {}

  move(actor: Actor, jobId: string, verb: Verb): Promise<JobDto> {
    return this.write(actor, jobId, verb, async (tx, job) => {
      this.judge(actor, job, verb);
      const { kind, request, to } = VERBS[verb];
      const ports = { audit: this.audit, events: this.events };
      const pausedJobIds =
        to === 'in_work' ? await this.pauseOthers(tx, job) : null;
      await moveJob(tx, ports, {
        actor,
        event: {
          audience: audience(job),
          kind,
          payload: pausedJobIds
            ? { pausedJobIds }
            : verb === 'pause'
              ? { auto: false }
              : {},
        },
        id: job.id,
        to,
      });
      if (request) {
        await moveRequest(
          tx,
          { audit: this.audit, events: noEvents },
          {
            actor,
            event: { audience: audience(job), kind },
            id: job.request_id,
            to: request,
          },
        );
      }
    });
  }

  // The owner or the job's mechanic, from the verb's own stage; a finish
  // before the start and a start before the reception have their own codes.
  private judge(actor: Actor, job: LockedJob, verb: Verb) {
    if (actor.role !== 'garage' && !this.own(actor, job)) {
      throw this.forbidden();
    }
    const { from, to } = VERBS[verb];
    if (verb === 'finish' && job.status === 'to_do') {
      throw this.refuse(job, 'job_not_started', 'Lucrarea nu a început');
    }
    if (!from.includes(job.status)) {
      this.logger.warn(
        `job stage refused: invalid_transition job=${job.id} ${verb}`,
      );
      throw invalidTransition({
        currentStatus: job.status,
        entity: 'job',
        to,
      });
    }
    if (verb === 'start' && !job.received_at) {
      throw this.refuse(job, 'not_received', 'Fă recepția mai întâi');
    }
  }

  // A reading at the reception: the job keeps the latest, every reading is
  // kept on the car, and the car shows its newest, a lower one included.
  receive(actor: Actor, jobId: string, km: number): Promise<JobDto> {
    return this.write(actor, jobId, 'receive', async (tx, job) => {
      const desk = actor.role === 'garage' || actor.role === 'receptionist';
      if (!desk && !this.own(actor, job)) {
        throw this.forbidden();
      }
      if (CLOSED.includes(job.status)) {
        throw this.refuse(job, 'job_closed', 'Lucrarea este închisă');
      }
      if (job.status === 'paused') {
        throw this.refuse(job, 'invalid_state', 'Reia lucrarea mai întâi');
      }
      const by = {
        actorId: actor.accountId,
        actorRole: actor.role,
        carId: job.car_id,
        garageId: job.garage_id,
      };
      await tx.job.update({
        data: { odometerKm: km, receivedAt: job.received_at ?? new Date() },
        where: { id: job.id },
      });
      // The car is locked before its reading is written, as a driver's edit does.
      await this.followCar(tx, by, job.car_id, km);
      await tx.odometerReading.create({
        data: {
          carId: job.car_id,
          km,
          readOn: today(),
          source: 'reception',
          sourceId: job.id,
        },
      });
      await this.audit.record(tx, {
        ...by,
        action: 'update',
        field: 'odometer_km',
        jobId: job.id,
        newValue: km,
        oldValue: job.odometer_km,
        subjectId: job.id,
        subjectType: 'job',
      });
      await this.events.record(tx, {
        audience: audience(job),
        kind: 'job.received',
        payload: { odometerKm: km },
        subjectId: job.id,
      });
    });
  }

  // The car's odometer is its newest reading, by day then creation: today's
  // reception is it unless the driver dated one later.
  private async followCar(
    tx: Tx,
    by: { actorId: string; actorRole: Actor['role']; garageId: string },
    carId: string,
    km: number,
  ) {
    const [car] = await tx.$queryRaw<
      { odometer_km: number; owner_id: string }[]
    >`
      SELECT odometer_km, owner_id FROM car WHERE id = ${carId}::uuid FOR UPDATE`;
    const later = await tx.odometerReading.count({
      where: { carId, readOn: { gt: today() } },
    });
    if (!car || later > 0 || km === car.odometer_km) return;
    await tx.car.update({ data: { odometerKm: km }, where: { id: carId } });
    await this.audit.record(tx, {
      ...by,
      action: 'update',
      carId,
      field: 'odometerKm',
      newValue: km,
      oldValue: car.odometer_km,
      subjectId: carId,
      subjectType: 'car',
    });
    await this.events.record(tx, {
      audience: { ownerAccountId: car.owner_id, type: 'car' },
      kind: 'car.updated',
      payload: { carId, changed: ['odometerKm'], ownerId: car.owner_id },
      subjectId: carId,
    });
  }

  // A mechanic works one job at a time in a garage with a team: moving one
  // into work pauses their others, as the platform, in the same transaction.
  private async pauseOthers(tx: Tx, job: LockedJob): Promise<string[]> {
    if (!job.mechanic_id) return [];
    if (!(await featureOn(tx, job.garage_id, TEAM))) return [];
    const busy = await tx.$queryRaw<LockedJob[]>`
      SELECT id, garage_id, car_id, driver_id, mechanic_id
      FROM job
      WHERE garage_id = ${job.garage_id}::uuid
        AND mechanic_id = ${job.mechanic_id}::uuid
        AND status = 'in_work' AND id <> ${job.id}::uuid
      ORDER BY id
      FOR UPDATE`;
    const ports = { audit: this.audit, events: this.events };
    for (const other of busy) {
      await moveJob(tx, ports, {
        actor: SYSTEM,
        auto: true,
        event: {
          audience: audience(other),
          kind: 'job.paused',
          payload: { auto: true },
        },
        id: other.id,
        to: 'paused',
      });
    }
    return busy.map((other) => other.id);
  }

  // Locks the job, runs the change, counts the call either way and answers
  // the job as the garage reads it once the transaction has committed.
  private async write(
    actor: Actor,
    jobId: string,
    action: JobStageAction,
    change: (tx: Tx, job: LockedJob) => Promise<void>,
  ): Promise<JobDto> {
    requireCapability(actor, 'garage.own_jobs');
    try {
      await this.prisma.$transaction(async (tx) =>
        change(tx, await this.lock(tx, actor, jobId)),
      );
    } catch (error) {
      if (error instanceof HttpException) countJobStageMove(action, 'refused');
      throw error;
    }
    countJobStageMove(action, 'ok');
    return this.jobs.get(actor, jobId);
  }

  // Another garage's job, or none, does not exist for the caller.
  private async lock(tx: Tx, actor: Actor, jobId: string): Promise<LockedJob> {
    const [job] = await tx.$queryRaw<LockedJob[]>`
      SELECT j.id, j.garage_id, j.car_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, b.request_id, j.status,
             j.received_at, j.odometer_km
      FROM job j
      JOIN booking b ON b.id = j.booking_id
      LEFT JOIN mechanic m ON m.id = j.mechanic_id
      WHERE j.id = ${jobId}::uuid
      FOR UPDATE OF j`;
    if (!job || job.garage_id !== actor.garageId) throw new NotFoundException();
    return job;
  }

  private own(actor: Actor, job: LockedJob) {
    return (
      actor.role === 'mechanic' &&
      job.mechanic_account !== null &&
      job.mechanic_account === actor.accountId
    );
  }

  private forbidden() {
    return refusal(
      HttpStatus.FORBIDDEN,
      'forbidden',
      "Only the owner and the job's mechanic move it; the desk records the reception",
    );
  }

  // The refusal's log line carries the job's id and the code.
  private refuse(job: LockedJob, code: string, message: string) {
    this.logger.warn(`job stage refused: ${code} job=${job.id}`);
    return refusal(HttpStatus.CONFLICT, code, message);
  }
}
