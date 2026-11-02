import type {
  JobLockTakenDto,
  LockHolderRole,
  LockPurpose,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import { countJobLock } from './job-lock.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { firstName } from '../../audit/audit.service';
import { AUTH_REDIS } from '../../auth/attempts';
import { refusal } from '../../auth/http-refusal';
import { type Actor, forbidden } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { local } from '../../bucharest';
import { publishLive } from '../../events/live/live.hub';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

const LOCK_SECONDS = 300;
const LOCK_MS = LOCK_SECONDS * 1000;

export const lockKey = (jobId: string) => `job:lock:${jobId}`;

// What Redis holds for a held job.
interface HeldLock {
  holderId: string;
  firstName: string;
  role: LockHolderRole;
  since: string;
  lastChangeAt: string;
}

// A value this service did not write, or one cut short, counts as no lock.
export const parseHeld = (stored: string | null): HeldLock | null => {
  if (!stored) return null;
  try {
    const held = JSON.parse(stored);
    return typeof held?.holderId === 'string' &&
      typeof held.firstName === 'string' &&
      Object.hasOwn(ROLE_RO, held.role) &&
      typeof held.since === 'string' &&
      typeof held.lastChangeAt === 'string'
      ? held
      : null;
  } catch {
    return null;
  }
};

// The job's fields a lock reads: who it belongs to and whom a change reaches.
interface LockedJobRef {
  id: string;
  garage_id: string;
  mechanic_id: string | null;
  updated_at: Date;
}

// What a change took: whether this request took the key, so that a refused
// change gives back only what it took.
export interface Hold {
  took: boolean;
}

const STAFF: readonly string[] = ['garage', 'receptionist', 'mechanic'];

const ROLE_RO: Record<LockHolderRole, string> = {
  mechanic: 'mecanic',
  owner: 'proprietar',
  receptionist: 'recepționer',
};

// The holder's own lock gets a new last change; another's is answered as it is.
const REFRESH = `
local v = redis.call('GET', KEYS[1])
if not v then return false end
local ok, held = pcall(cjson.decode, v)
if not ok or type(held) ~= 'table' or type(held.holderId) ~= 'string' then
  redis.call('DEL', KEYS[1])
  return false
end
if held.holderId ~= ARGV[1] then return v end
held.lastChangeAt = ARGV[2]
local n = cjson.encode(held)
redis.call('SET', KEYS[1], n, 'EX', ARGV[3])
return n`;

// Deletes the key only while the named person holds it.
const RELEASE = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
local ok, held = pcall(cjson.decode, v)
if ok and type(held) == 'table' and held.holderId ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1`;

const holderRole = (actor: Actor): LockHolderRole =>
  actor.role === 'garage' ? 'owner' : (actor.role as LockHolderRole);

const clock = (at: Date) => {
  const { hour, minute } = local(at);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const lockedMessage = (held: HeldLock) =>
  `Blocat de ${held.firstName}, ${ROLE_RO[held.role]}, de la ${clock(new Date(held.since))}`;

const forcedText = (held: HeldLock) =>
  `${held.firstName}, ${ROLE_RO[held.role]}, de la ${held.since}`;

class JobChanged extends HttpException {
  constructor(readonly updatedAt: Date) {
    super({ code: 'job_changed' }, HttpStatus.CONFLICT);
  }
}

const locked = (held: HeldLock) =>
  new HttpException(
    {
      code: 'job_locked',
      holder: { firstName: held.firstName, role: held.role, since: held.since },
      message: lockedMessage(held),
    },
    HttpStatus.LOCKED,
  );

// Redis decides who holds a job; the job's row keeps a copy for the reads
// and for the sweep. A lock is taken by the first person who opens the job
// to change it, refreshed by each of their changes and ends with the change,
// a release, the owner's force or five idle minutes.
@Injectable()
export class JobLockService {
  private readonly logger = new Logger('JobLock');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async take(
    actor: Actor,
    jobId: string,
    purpose: LockPurpose = 'edit',
  ): Promise<JobLockTakenDto> {
    const job = await this.reach(actor, jobId);
    if (actor.role === 'receptionist' && purpose === 'edit') {
      throw forbidden(
        'The desk takes a job for its reception or handover only',
      );
    }
    const { held, fresh } = await this.claim(this.prisma, actor, jobId);
    if (held.holderId !== actor.accountId) {
      countJobLock('locked');
      throw locked(held);
    }
    const row = await this.mirror(actor, jobId, fresh, {
      data: {
        lockHolderId: held.holderId,
        lockHolderRole: held.role,
        lockLastChangeAt: new Date(held.lastChangeAt),
        lockSince: new Date(held.since),
        ...(job.lockForcedHolderId === actor.accountId && {
          lockForcedAt: null,
          lockForcedById: null,
          lockForcedHolderId: null,
        }),
      },
      select: { updatedAt: true },
      where: { id: jobId },
    });
    countJobLock(fresh ? 'take' : 'refresh');
    if (fresh) this.changed(job);
    return {
      expiresAt: new Date(
        Date.parse(held.lastChangeAt) + LOCK_MS,
      ).toISOString(),
      holder: {
        accountId: held.holderId,
        firstName: held.firstName,
        role: held.role,
      },
      lastChangeAt: held.lastChangeAt,
      since: held.since,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Nothing to release answers the same as a release: another's lock is left
  // alone unless the owner forces it.
  async release(actor: Actor, jobId: string, force = false): Promise<void> {
    const job = await this.reach(actor, jobId);
    if (force && actor.role !== 'garage') {
      throw forbidden('Only the owner lifts another person’s lock');
    }
    const held = await this.read(jobId);
    if (!held) return;
    if (held.holderId === actor.accountId) {
      if (!(await this.drop(jobId, actor.accountId))) return;
      await this.prisma.job.update({ data: cleared, where: { id: jobId } });
      countJobLock('release');
      this.changed(job);
      return;
    }
    if (!force || !(await this.drop(jobId, held.holderId))) return;
    const at = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        data: {
          ...cleared,
          lockForcedAt: at,
          lockForcedById: actor.accountId,
          lockForcedHolderId: held.holderId,
        },
        where: { id: jobId },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'lock_holder_id',
        garageId: job.garage_id,
        internal: true,
        jobId,
        kind: 'job.lock_forced',
        newValue: null,
        oldValue: held.holderId,
        subjectId: jobId,
        subjectType: 'job',
        text: forcedText(held),
      });
    });
    countJobLock('force');
    this.changed(job);
  }

  // Inside a change's transaction, once the row is locked and the caller may
  // change it: another's lock is answered first, then a change made from an
  // older read of the job.
  async hold(
    tx: Tx,
    actor: Actor,
    job: LockedJobRef,
    basedOnUpdatedAt: string | undefined,
  ): Promise<Hold> {
    const { held, fresh } = await this.claim(tx, actor, job.id, false);
    if (held.holderId !== actor.accountId) {
      countJobLock('locked');
      throw locked(held);
    }
    if (
      basedOnUpdatedAt !== undefined &&
      Date.parse(basedOnUpdatedAt) !== job.updated_at.getTime()
    ) {
      countJobLock('stale');
      if (fresh) await this.drop(job.id, actor.accountId);
      throw new JobChanged(job.updated_at);
    }
    return { took: fresh };
  }

  // The change's own write: the copy of the lock it ends and, when the job
  // moved, a new version. A change that wrote nothing still ends the lock.
  settle(tx: Tx, jobId: string, moved = true) {
    return tx.job.update({
      data: { ...cleared, ...(moved && { updatedAt: new Date() }) },
      where: { id: jobId },
    });
  }

  // After the change committed, its lock ends.
  async after(actor: Actor, job: LockedJobRef, hold: Hold | undefined) {
    if (hold && (await this.dropQuietly(actor, job))) this.changed(job);
  }

  // After the change was refused, only a lock this request took ends. The
  // job a stale change is answered with is read here, once the transaction
  // gave its connection back.
  async refused(
    actor: Actor,
    job: LockedJobRef | undefined,
    hold: Hold | undefined,
    error: unknown,
    current: () => Promise<unknown>,
  ): Promise<unknown> {
    if (job && hold?.took) await this.dropQuietly(actor, job);
    if (!(error instanceof JobChanged)) return error;
    return new HttpException(
      {
        code: 'job_changed',
        job: await current(),
        message: 'Lucrarea s-a schimbat între timp',
        updatedAt: error.updatedAt.toISOString(),
      },
      HttpStatus.CONFLICT,
    );
  }

  private async dropQuietly(actor: Actor, job: LockedJobRef) {
    try {
      await this.drop(job.id, actor.accountId);
      return true;
    } catch (error) {
      this.logger.warn(
        `job lock not released: job=${job.id} ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Only a nudge for the job's readers to read again: not awaited.
  changed(job: Pick<LockedJobRef, 'id' | 'garage_id' | 'mechanic_id'>) {
    publishLive(
      this.redis,
      { at: new Date().toISOString(), id: job.id, kind: 'job.lock_changed' },
      [
        `garage:${job.garage_id}`,
        ...(job.mechanic_id ? [`mechanic:${job.mechanic_id}`] : []),
      ],
    ).catch((error: Error) =>
      this.logger.warn(`job.lock_changed not sent: ${error.message}`),
    );
  }

  // Another garage's job, or none, does not exist for the caller, whatever
  // their role; a mechanic of the garage who is not on the job is told no.
  private async reach(actor: Actor, jobId: string) {
    const job =
      actor.garageId && STAFF.includes(actor.role)
        ? await this.prisma.job.findFirst({
            select: {
              garageId: true,
              id: true,
              lockForcedHolderId: true,
              mechanic: { select: { accountId: true } },
              mechanicId: true,
            },
            where: { garageId: actor.garageId, id: jobId },
          })
        : null;
    if (!job) throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such job');
    if (
      actor.role === 'mechanic' &&
      job.mechanic?.accountId !== actor.accountId
    ) {
      throw forbidden('Only the job’s own mechanic takes it');
    }
    return {
      garage_id: job.garageId,
      id: job.id,
      lockForcedHolderId: job.lockForcedHolderId,
      mechanic_id: job.mechanicId,
    };
  }

  // Takes a free job, or refreshes the caller's own lock; another's lock is
  // answered as it stands. A change refreshes nothing: it ends the lock.
  private async claim(
    db: Tx,
    actor: Actor,
    jobId: string,
    refresh = true,
  ): Promise<{ held: HeldLock; fresh: boolean }> {
    const now = new Date().toISOString();
    const { name } = await db.account.findUniqueOrThrow({
      select: { name: true },
      where: { id: actor.accountId },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const mine: HeldLock = {
        firstName: firstName(name),
        holderId: actor.accountId,
        lastChangeAt: now,
        role: holderRole(actor),
        since: now,
      };
      const set = await this.unavailable(() =>
        this.redis.set(
          lockKey(jobId),
          JSON.stringify(mine),
          'EX',
          LOCK_SECONDS,
          'NX',
        ),
      );
      if (set === 'OK') return { fresh: true, held: mine };
      const stored = await this.unavailable(() =>
        refresh
          ? (this.redis.eval(
              REFRESH,
              1,
              lockKey(jobId),
              actor.accountId,
              now,
              LOCK_SECONDS,
            ) as Promise<string | null>)
          : this.redis.get(lockKey(jobId)),
      );
      const held = parseHeld(stored);
      if (held) return { fresh: false, held };
      if (stored) await this.unavailable(() => this.redis.del(lockKey(jobId)));
    }
    this.logger.warn(`job lock not claimed: job=${jobId} after two tries`);
    throw this.tryAgain();
  }

  // A key whose copy could not be written is given back, so the job is not
  // held by a lock its readers cannot see.
  private async mirror(
    actor: Actor,
    jobId: string,
    fresh: boolean,
    write: Prisma.JobUpdateArgs & { select: { updatedAt: true } },
  ) {
    try {
      return await this.prisma.job.update(write);
    } catch (error) {
      this.logger.warn(
        `job lock copy not written: job=${jobId} ${(error as Error).message}`,
      );
      if (fresh) await this.drop(jobId, actor.accountId).catch(() => false);
      throw this.tryAgain();
    }
  }

  private async read(jobId: string): Promise<HeldLock | null> {
    const stored = await this.unavailable(() => this.redis.get(lockKey(jobId)));
    return parseHeld(stored);
  }

  private async drop(jobId: string, holderId: string) {
    const dropped = await this.unavailable(
      () =>
        this.redis.eval(
          RELEASE,
          1,
          lockKey(jobId),
          holderId,
        ) as Promise<number>,
    );
    return dropped === 1;
  }

  private async unavailable<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(
        `job lock store unreachable: ${(error as Error).message}`,
      );
      countJobLock('unavailable');
      throw this.tryAgain();
    }
  }

  private tryAgain() {
    return refusal(
      HttpStatus.SERVICE_UNAVAILABLE,
      'try_again',
      'Încearcă din nou în câteva secunde',
    );
  }
}

const cleared = {
  lockHolderId: null,
  lockHolderRole: null,
  lockLastChangeAt: null,
  lockSince: null,
};
