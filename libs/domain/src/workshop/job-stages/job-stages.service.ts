import {
  type EventKind,
  FINAL_PRICE_CORRECTION_HOURS,
  type JobDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { today } from '../../bucharest';
import { EVENT_PORT, type EventPort, noEvents } from '../../events/event.port';
import { featureOn } from '../../garages/features/feature-on';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import {
  countJobStageMove,
  type JobStageAction,
} from '../../metrics/product-counters';
import { moveBooking, moveRequest } from '../../quotes/transitions';
import { invalidTransition, type TransitionActor } from '../../transitions';
import { GarageJobsService } from '../garage-jobs/garage-jobs.service';
import { type Hold, JobLockService } from '../job-lock/job-lock.service';
import { moveJob } from '../transitions';

type Tx = Prisma.TransactionClient;
type Verb = Exclude<JobStageAction, 'receive' | 'handover' | 'correct'>;

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
  booking_id: string;
  booking_status: BookingStatus;
  booking_mechanic: string | null;
  final_price_bani: number | null;
  handed_over_at: Date | null;
  updated_at: Date;
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

const CLOSED: readonly JobStatus[] = ['done', 'cancelled'];
const HOUR = 3_600_000;
const SYSTEM: TransitionActor = { accountId: null, role: 'system' };
const TEAM = 'team_mechanics';

type Audienced = Pick<
  LockedJob,
  'id' | 'garage_id' | 'car_id' | 'driver_id' | 'mechanic_id'
>;

const audience = (job: Audienced) => ({
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
    private readonly locks: JobLockService,
  ) {}

  move(
    actor: Actor,
    jobId: string,
    verb: Verb,
    basedOn?: string,
  ): Promise<JobDto> {
    const permit = (job: LockedJob) => {
      if (actor.role !== 'garage' && !this.own(actor, job)) {
        throw this.forbidden();
      }
    };
    return this.write(actor, jobId, verb, basedOn, permit, async (tx, job) => {
      this.judge(job, verb);
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

  // From the verb's own stage; a finish before the start and a start before
  // the reception have their own codes.
  private judge(job: LockedJob, verb: Verb) {
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
  receive(
    actor: Actor,
    jobId: string,
    km: number,
    basedOn?: string,
  ): Promise<JobDto> {
    const permit = (job: LockedJob) => {
      const desk = actor.role === 'garage' || actor.role === 'receptionist';
      if (!desk && !this.own(actor, job)) {
        throw this.forbidden();
      }
    };
    return this.write(
      actor,
      jobId,
      'receive',
      basedOn,
      permit,
      async (tx, job) => {
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
      },
    );
  }

  // The handover: the owner or the desk records the price the driver paid
  // for a done job, which completes its booking. A mechanic never does,
  // whatever their final-price flag says.
  handover(
    actor: Actor,
    jobId: string,
    price: number,
    basedOn?: string,
  ): Promise<JobDto> {
    const permit = (job: LockedJob) => this.judgePrice(actor, job);
    return this.write(
      actor,
      jobId,
      'handover',
      basedOn,
      permit,
      async (tx, job) => {
        if (job.status !== 'done') {
          throw this.refuse(
            job,
            'job_not_done',
            'Marchează întâi lucrarea ca gata',
          );
        }
        if (job.handed_over_at) {
          this.logger.warn(
            `job stage refused: already_handed_over job=${job.id}`,
          );
          throw new HttpException(
            {
              code: 'already_handed_over',
              finalPriceBani: job.final_price_bani,
              message: 'Mașina a fost deja predată',
            },
            HttpStatus.CONFLICT,
          );
        }
        if (job.booking_status !== 'completed') {
          await moveBooking(
            tx,
            { audit: this.audit, events: this.events },
            {
              actor,
              event: {
                audience: {
                  driverAccountId: job.driver_id,
                  garageId: job.garage_id,
                  mechanicId: job.booking_mechanic,
                  type: 'booking',
                },
                kind: 'booking.completed',
              },
              id: job.booking_id,
              to: 'completed',
            },
          );
        }
        const now = new Date();
        await tx.job.update({
          data: {
            finalPriceBani: price,
            finalPriceRecordedById: actor.accountId,
            handedOverAt: now,
          },
          where: { id: job.id },
        });
        await this.audit.recordMany(tx, [
          priceEntry(actor, job, 'final_price_bani', null, price),
          priceEntry(actor, job, 'handed_over_at', null, now.toISOString()),
        ]);
        await this.events.record(tx, {
          audience: audience(job),
          kind: 'job.handed_over',
          payload: { by: actor.accountId, finalPriceBani: price },
          subjectId: job.id,
        });
      },
    );
  }

  // A correction of the recorded price, within 48 hours of the handover, as
  // often as needed; the same price again changes nothing.
  correct(
    actor: Actor,
    jobId: string,
    price: number,
    basedOn?: string,
  ): Promise<JobDto> {
    const permit = (job: LockedJob) => this.judgePrice(actor, job);
    return this.write(
      actor,
      jobId,
      'correct',
      basedOn,
      permit,
      async (tx, job) => {
        if (!job.handed_over_at) {
          throw this.refuse(
            job,
            'not_handed_over',
            'Mașina nu a fost încă predată',
          );
        }
        const closes =
          job.handed_over_at.getTime() + FINAL_PRICE_CORRECTION_HOURS * HOUR;
        if (Date.now() >= closes) {
          throw this.refuse(
            job,
            'correction_window_closed',
            'Prețul final nu mai poate fi corectat',
          );
        }
        if (price === job.final_price_bani) return;
        await tx.job.update({
          data: { finalPriceBani: price, finalPriceCorrectedAt: new Date() },
          where: { id: job.id },
        });
        await this.audit.record(
          tx,
          priceEntry(
            actor,
            job,
            'final_price_bani',
            job.final_price_bani,
            price,
          ),
        );
        await this.events.record(tx, {
          audience: audience(job),
          kind: 'job.final_price_corrected',
          payload: {
            by: actor.accountId,
            newBani: price,
            oldBani: job.final_price_bani,
          },
          subjectId: job.id,
        });
      },
    );
  }

  // The owner and the desk record the final price; a mechanic never does.
  private judgePrice(actor: Actor, job: LockedJob) {
    if (actor.role === 'mechanic') {
      this.logger.warn(`job stage refused: forbidden job=${job.id}`);
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'The owner and the desk record the final price',
      );
    }
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
  // The mechanic's row is locked first, so two of their jobs moving into work
  // at once take turns and the second sees the first in work.
  private async pauseOthers(tx: Tx, job: LockedJob): Promise<string[]> {
    if (!job.mechanic_id) return [];
    if (!(await featureOn(tx, job.garage_id, TEAM))) return [];
    await tx.$queryRaw`
      SELECT id FROM mechanic WHERE id = ${job.mechanic_id}::uuid FOR UPDATE`;
    const busy = await tx.$queryRaw<Audienced[]>`
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

  // Locks the job's row, checks the caller may change it, then that no one
  // else holds it and that the caller read its latest version, and only then
  // runs the change; counts the call either way and answers the job as the
  // garage reads it once the transaction has committed.
  private async write(
    actor: Actor,
    jobId: string,
    action: JobStageAction,
    basedOn: string | undefined,
    permit: (job: LockedJob) => void,
    change: (tx: Tx, job: LockedJob) => Promise<void>,
  ): Promise<JobDto> {
    requireCapability(actor, 'garage.own_jobs');
    const met: { job?: LockedJob; hold?: Hold } = {};
    try {
      await this.prisma.$transaction(async (tx) => {
        const job = await this.lock(tx, actor, jobId);
        met.job = job;
        permit(job);
        met.hold = await this.locks.hold(tx, actor, job, basedOn);
        await change(tx, job);
        await this.locks.settle(tx, job.id);
      });
    } catch (error) {
      if (error instanceof HttpException) countJobStageMove(action, 'refused');
      throw await this.locks.refused(actor, met.job, met.hold, error, () =>
        this.jobs.get(actor, jobId),
      );
    }
    if (met.job) await this.locks.after(actor, met.job, met.hold);
    countJobStageMove(action, 'ok');
    return this.jobs.get(actor, jobId);
  }

  // Another garage's job, or none, does not exist for the caller.
  private async lock(tx: Tx, actor: Actor, jobId: string): Promise<LockedJob> {
    const [job] = await tx.$queryRaw<LockedJob[]>`
      SELECT j.id, j.garage_id, j.car_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, b.request_id, j.status,
             j.received_at, j.odometer_km, j.booking_id,
             b.status AS booking_status, b.mechanic_id AS booking_mechanic,
             j.final_price_bani, j.handed_over_at, j.updated_at
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

  private refuse(job: LockedJob, code: string, message: string) {
    this.logger.warn(`job stage refused: ${code} job=${job.id}`);
    return refusal(HttpStatus.CONFLICT, code, message);
  }
}

// One audited change to a job's final price or handover time.
function priceEntry(
  actor: Actor,
  job: LockedJob,
  field: string,
  oldValue: number | string | null,
  newValue: number | string,
): AuditEntry {
  return {
    action: 'update',
    actorId: actor.accountId,
    actorRole: actor.role,
    carId: job.car_id,
    field,
    garageId: job.garage_id,
    jobId: job.id,
    newValue,
    oldValue,
    subjectId: job.id,
    subjectType: 'job',
  };
}
