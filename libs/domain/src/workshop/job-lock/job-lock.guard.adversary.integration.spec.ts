import { Redis } from 'ioredis';

import { quotesApp } from '../../quotes/quotes-api.testing';
import { JobLockSweepModule } from '../job-lock-sweep/job-lock-sweep.module';
import { JobLockSweep } from '../job-lock-sweep/job-lock-sweep.service';

const { bearer, get, provider, send, team, world } = quotesApp([
  JobLockSweepModule,
]);
const { prisma } = world;

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const keys = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
let published: { audience: string[]; event: { kind: string; id: string } }[] =
  [];

beforeAll(async () => {
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message: string) =>
    published.push(JSON.parse(message)),
  );
});

afterAll(() => {
  subscriber.disconnect();
  keys.disconnect();
});

beforeEach(() => {
  published = [];
});

async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  await prisma.account.update({
    data: { name: 'Ion Popescu' },
    where: { id: dinamo.owner },
  });
  await prisma.account.update({
    data: { name: '😀Mihai Dobre' },
    where: { id: dinamo.plain },
  });
  const { booking } = await world.chain(andrei, dinamo.garage.id, {
    request: 'booked',
  });
  const created = await world.job(booking.id, 'to_do', {
    mechanicId: dinamo.plainMechanic.id,
  });
  const job = await prisma.job.update({
    data: { receivedAt: new Date() },
    where: { id: created.id },
  });
  return {
    andrei,
    desk: bearer(dinamo.receptionist, 'receptionist'),
    dinamo,
    hand: bearer(dinamo.plain, 'mechanic'),
    job,
    lock: `/garage/jobs/${job.id}/lock`,
    offJob: bearer(dinamo.answering, 'mechanic'),
    owner: bearer(dinamo.owner, 'garage'),
    start: `/garage/jobs/${job.id}/start`,
  };
}

const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });
const keyOf = (id: string) => keys.exists(`job:lock:${id}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const lockChanges = (id: string) =>
  published.filter(
    (m) => m.event.kind === 'job.lock_changed' && m.event.id === id,
  );

// @traces 395-FR-003
describe('a forced unlock asked by the wrong person', () => {
  it.each([
    ['receptionist', 'desk'],
    ['mechanic', 'offJob'],
  ] as const)('is refused a %s and leaves the lock', async (_, who) => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const res = await send('delete', `${s.lock}?force=true`, s[who]);

    expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
    expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
    expect(await keyOf(s.job.id)).toBe(1);
  });

  it('is refused the job’s own mechanic on a free job', async () => {
    const s = await setting();

    const res = await send('delete', `${s.lock}?force=true`, s.hand);

    expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
  });

  it('is refused a holder who forces their own lock', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const res = await send('delete', `${s.lock}?force=true`, s.hand);

    expect(res.status).toBe(403);
    expect(await keyOf(s.job.id)).toBe(1);
  });

  it('lifts nothing and records nothing when the owner forces a free job', async () => {
    const s = await setting();

    const res = await send('delete', `${s.lock}?force=true`, s.owner);

    expect(res.status).toBe(204);
    expect(
      await prisma.activityLog.count({ where: { subjectId: s.job.id } }),
    ).toBe(0);
    expect((await reread(s.job.id)).lockForcedAt).toBeNull();
    await settle();
    expect(lockChanges(s.job.id)).toEqual([]);
  });

  it('does not force on a value that is not exactly true', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const res = await send('delete', `${s.lock}?force=false`, s.owner);

    expect(res.status).toBe(204);
    expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
  });

  it('forces once when asked twice, with one audit entry', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const first = await send('delete', `${s.lock}?force=true`, s.owner);
    const second = await send('delete', `${s.lock}?force=true`, s.owner);

    expect([first.status, second.status]).toEqual([204, 204]);
    expect(
      await prisma.activityLog.count({ where: { subjectId: s.job.id } }),
    ).toBe(1);
  });
});

// @traces 395-FR-001 395-FR-002
describe('the lock routes with hostile input', () => {
  it('refuses a job id that is not a uuid', async () => {
    const s = await setting();

    const res = await send('post', '/garage/jobs/not-a-uuid/lock', s.owner);

    expect(res.status).toBe(400);
  });

  it('refuses a body with a field it does not know', async () => {
    const s = await setting();

    const res = await send('post', s.lock, s.owner, { extra: 1 });

    expect(res.status).toBe(400);
    expect(await keyOf(s.job.id)).toBe(0);
  });

  it('refuses a purpose that is not a string', async () => {
    const s = await setting();

    const res = await send('post', s.lock, s.owner, { purpose: ['edit'] });

    expect(res.status).toBe(400);
  });

  it('answers a visitor 401', async () => {
    const s = await setting();

    const res = await send('post', s.lock, 'Bearer nonsense');

    expect(res.status).toBe(401);
  });

  it('names a holder whose name starts with an emoji by its first name', async () => {
    const s = await setting();

    const res = await send('post', s.lock, s.hand);

    expect(res.body.holder.firstName).toBe('😀Mihai');
  });

  it('lets the owner take every purpose', async () => {
    const s = await setting();

    for (const purpose of ['edit', 'reception', 'handover']) {
      const res = await send('post', s.lock, s.owner, { purpose });
      expect([purpose, res.status]).toEqual([purpose, 200]);
    }
  });

  it('keeps since when the same person takes it ten times at once', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    const { lockSince } = await reread(s.job.id);

    const all = await Promise.all(
      Array.from({ length: 10 }, () => send('post', s.lock, s.hand)),
    );

    expect(all.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect((await reread(s.job.id)).lockSince).toEqual(lockSince);
  });

  it('leaves exactly one winner among many different takers', async () => {
    const s = await setting();

    const all = await Promise.all([
      send('post', s.lock, s.owner),
      send('post', s.lock, s.hand),
      send('post', s.lock, s.owner),
      send('post', s.lock, s.hand),
    ]);

    const holder = (await reread(s.job.id)).lockHolderId;
    const name = holder === s.dinamo.owner ? 'Ion' : '😀Mihai';
    const winners = all.filter((r) => r.status === 200);
    const refused = all.filter((r) => r.status === 423);
    expect(winners.every((r) => r.body.holder.accountId === holder)).toBe(true);
    expect(refused.every((r) => r.body.holder.firstName === name)).toBe(true);
    expect(winners.length + refused.length).toBe(4);
  });
});

// @traces 395-FR-004 395-FR-005
describe('the stale-change check and the lock order', () => {
  it('answers 409 job_changed with the current updatedAt and job', async () => {
    const s = await setting();
    const stale = (await reread(s.job.id)).updatedAt.toISOString();
    await send('post', `/garage/jobs/${s.job.id}/start`, s.owner);
    await send('post', `/garage/jobs/${s.job.id}/pause`, s.owner);
    const current = await reread(s.job.id);

    const res = await send('post', `/garage/jobs/${s.job.id}/resume`, s.owner, {
      basedOnUpdatedAt: stale,
    });

    expect([res.status, res.body.code]).toEqual([409, 'job_changed']);
    expect(res.body.updatedAt).toBe(current.updatedAt.toISOString());
    expect(res.body.job?.id ?? res.body.current?.id).toBe(s.job.id);
    expect((await reread(s.job.id)).status).toBe('paused');
    expect(await keyOf(s.job.id)).toBe(0);
  });

  it('applies a change whose basedOnUpdatedAt equals the current value', async () => {
    const s = await setting();
    const taken = await send('post', s.lock, s.hand);

    const res = await send('post', s.start, s.hand, {
      basedOnUpdatedAt: taken.body.updatedAt,
    });

    expect(res.status).toBe(200);
    expect((await reread(s.job.id)).status).toBe('in_work');
  });

  it('refuses a basedOnUpdatedAt one millisecond older', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await send('post', s.start, s.owner, {
      basedOnUpdatedAt: new Date(updatedAt.getTime() - 1).toISOString(),
    });

    expect([res.status, res.body.code]).toEqual([409, 'job_changed']);
  });

  it('refuses a basedOnUpdatedAt one millisecond newer', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await send('post', s.start, s.owner, {
      basedOnUpdatedAt: new Date(updatedAt.getTime() + 1).toISOString(),
    });

    expect([res.status, res.body.code]).toEqual([409, 'job_changed']);
  });

  it.each([['yesterday'], [12345], [true]])(
    'refuses a malformed basedOnUpdatedAt (%p)',
    async (value) => {
      const s = await setting();

      const res = await send('post', s.start, s.owner, {
        basedOnUpdatedAt: value,
      });

      expect(res.status).toBe(400);
      expect((await reread(s.job.id)).status).toBe('to_do');
    },
  );

  it('keeps the lock the caller held when the change is stale', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const res = await send('post', s.start, s.hand, {
      basedOnUpdatedAt: '2001-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(409);
    expect(await keyOf(s.job.id)).toBe(1);
    expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
  });

  it('answers 423 before 409 when another holds a stale job', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const res = await send('post', s.start, s.owner, {
      basedOnUpdatedAt: '2001-01-01T00:00:00.000Z',
    });

    expect([res.status, res.body.code]).toEqual([423, 'job_locked']);
  });

  it('answers 403 before 423 to a mechanic off the job', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const res = await send('post', s.start, s.offJob);

    expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
  });

  it('refuses a receptionist a start and leaves no lock behind', async () => {
    const s = await setting();

    const res = await send('post', s.start, s.desk);

    expect(res.status).toBe(403);
    expect(await keyOf(s.job.id)).toBe(0);
    expect((await reread(s.job.id)).lockHolderId).toBeNull();
  });

  it('refuses a stale step tick and leaves the step untouched', async () => {
    const s = await setting();
    const step = await send(
      'post',
      `/garage/jobs/${s.job.id}/steps`,
      s.owner,
      { text: 'Etriere' },
      { 'Idempotency-Key': 'adv-step' },
    );

    const res = await send(
      'put',
      `/garage/jobs/${s.job.id}/steps/${step.body.id}/done`,
      s.owner,
      { basedOnUpdatedAt: '2001-01-01T00:00:00.000Z', done: true },
    );

    expect([res.status, res.body.code]).toEqual([409, 'job_changed']);
    expect(await keyOf(s.job.id)).toBe(0);
  });

  it('refuses a stale step removal sent as a query', async () => {
    const s = await setting();
    const step = await send(
      'post',
      `/garage/jobs/${s.job.id}/steps`,
      s.owner,
      { text: 'Etriere' },
      { 'Idempotency-Key': 'adv-step-2' },
    );

    const res = await send(
      'delete',
      `/garage/jobs/${s.job.id}/steps/${step.body.id}?basedOnUpdatedAt=2001-01-01T00:00:00.000Z`,
      s.owner,
    );

    expect([res.status, res.body.code]).toEqual([409, 'job_changed']);
  });

  it('moves updatedAt on a change and not on a take, a refresh or a release', async () => {
    const s = await setting();
    const before = (await reread(s.job.id)).updatedAt;

    await send('post', s.lock, s.hand);
    await send('post', s.lock, s.hand);
    await send('delete', s.lock, s.hand);
    await send('post', s.lock, s.owner);
    await send('delete', `${s.lock}?force=true`, s.owner);

    expect((await reread(s.job.id)).updatedAt).toEqual(before);
  });
});

// @traces 395-FR-009
describe('what the job read and the list return of the lock', () => {
  it('returns the lock, the version and no forced unlock on the detail and the list', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const detail = await get(`/garage/jobs/${s.job.id}`, s.owner);
    const list = await get('/garage/jobs', s.owner);

    const item = list.body.items.find((i: { id: string }) => i.id === s.job.id);
    for (const read of [detail.body, item]) {
      expect(read.lock.holder).toEqual({
        accountId: s.dinamo.plain,
        firstName: '😀Mihai',
        role: 'mechanic',
      });
      expect(read.lastForcedUnlock).toBeNull();
      expect(read.updatedAt).toBe(
        (await reread(s.job.id)).updatedAt.toISOString(),
      );
    }
  });

  it('returns lock null on a free job', async () => {
    const s = await setting();

    const detail = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(detail.body.lock).toBeNull();
    expect(detail.body.lastForcedUnlock).toBeNull();
  });

  it('returns who forced the unlock and keeps it after another take', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await send('delete', `${s.lock}?force=true`, s.owner);
    await send('post', s.lock, s.owner);

    const detail = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(detail.body.lastForcedUnlock).toMatchObject({
      by: { firstName: 'Ion', role: 'owner' },
      holderId: s.dinamo.plain,
    });
    expect(detail.body.lock.holder.accountId).toBe(s.dinamo.owner);
  });

  it('shows a mechanic off the job nothing of the lock', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const detail = await get(`/garage/jobs/${s.job.id}`, s.offJob);

    expect(detail.status).toBe(403);
    expect(JSON.stringify(detail.body)).not.toContain('Mihai');
  });

  it('returns neither field in the driver’s active request', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await send('delete', `${s.lock}?force=true`, s.owner);
    await send('post', s.lock, s.owner);

    const res = await get('/quote-requests/active', bearer(s.andrei, 'driver'));

    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('lastForcedUnlock');
    expect(text).not.toContain('"lock"');
    expect(text).not.toContain('Mihai');
    expect(text).not.toContain(s.dinamo.plain);
  });
});

// @traces 395-FR-007 395-FR-010
describe('the sweep run again and on odd states', () => {
  it('clears an expired lock once and publishes once across two runs', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await keys.pexpire(`job:lock:${s.job.id}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    published = [];

    const first = await provider(JobLockSweep).sweep();
    const second = await provider(JobLockSweep).sweep();
    await settle();

    expect([first, second]).toEqual([1, 0]);
    expect(lockChanges(s.job.id)).toHaveLength(1);
  });

  it('keeps the forced-unlock record when an expiry clears the mirror', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await send('delete', `${s.lock}?force=true`, s.owner);
    await send('post', s.lock, s.owner);
    await keys.pexpire(`job:lock:${s.job.id}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await provider(JobLockSweep).sweep();

    expect(await reread(s.job.id)).toMatchObject({
      lockForcedById: s.dinamo.owner,
      lockHolderId: null,
    });
  });

  it('does not move updatedAt when it clears or re-mirrors', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    const before = (await reread(s.job.id)).updatedAt;
    await keys.pexpire(`job:lock:${s.job.id}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await provider(JobLockSweep).sweep();

    expect((await reread(s.job.id)).updatedAt).toEqual(before);
  });

  it('clears the mirror of a lock on a done job too', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await prisma.job.update({
      data: { status: 'done' },
      where: { id: s.job.id },
    });
    await keys.del(`job:lock:${s.job.id}`);

    const cleared = await provider(JobLockSweep).sweep();

    expect(cleared).toBe(1);
    expect((await reread(s.job.id)).lockHolderId).toBeNull();
  });

  it('survives a key holding garbage', async () => {
    const s = await setting();
    await keys.set(`job:lock:${s.job.id}`, 'not json', 'PX', 60_000);

    await expect(provider(JobLockSweep).sweep()).resolves.toBe(0);
    expect((await reread(s.job.id)).lockHolderId).toBeNull();
  });

  it.each(['{}', 'not json'])(
    'lets a job be taken over a key holding %s',
    async (stored) => {
      const s = await setting();
      await keys.set(`job:lock:${s.job.id}`, stored, 'PX', 60_000);

      const res = await send('post', s.lock, s.hand);

      expect(res.status).toBe(200);
      expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
    },
  );
});
