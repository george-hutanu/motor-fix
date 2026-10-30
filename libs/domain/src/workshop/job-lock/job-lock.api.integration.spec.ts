import { Redis } from 'ioredis';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const FIVE_MINUTES = 5 * 60_000;

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

afterAll(async () => {
  subscriber.disconnect();
  keys.disconnect();
});

beforeEach(() => {
  published = [];
});

const named = (id: string, name: string) =>
  prisma.account.update({ data: { name }, where: { id } });

// A received job at Atelier Dinamo, the plain mechanic's, with the people
// renamed so the holder's first name reads as one.
async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  await named(dinamo.owner, 'Ion Popescu');
  await named(dinamo.plain, 'Mihai Dobre');
  await named(dinamo.receptionist, 'Ana Radu');
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
    owner: bearer(dinamo.owner, 'garage'),
  };
}

const take = (path: string, auth: string, purpose?: string) =>
  send('post', path, auth, purpose ? { purpose } : undefined);

const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

const changed = (jobId: string) =>
  published.filter(
    (m) => m.event.kind === 'job.lock_changed' && m.event.id === jobId,
  );

// Publishing is fire-and-forget over Redis, so a case waits for the message.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

// @traces 395-FR-001 395-FR-006 395-FR-008 395-FR-010
describe('POST /garage/jobs/:id/lock', () => {
  it('takes a free job for the caller and answers the lock', async () => {
    const s = await setting();
    const before = Date.now();

    const res = await take(s.lock, s.hand);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      expiresAt: expect.any(String),
      holder: {
        accountId: s.dinamo.plain,
        firstName: 'Mihai',
        role: 'mechanic',
      },
      lastChangeAt: res.body.since,
      since: expect.any(String),
      updatedAt: (await reread(s.job.id)).updatedAt.toISOString(),
    });
    const expires = Date.parse(res.body.expiresAt) - Date.parse(res.body.since);
    expect(expires).toBe(FIVE_MINUTES);
    expect(Date.parse(res.body.since)).toBeGreaterThanOrEqual(before - 5);
  });

  it('holds the key in Redis with a five minute time to live', async () => {
    const s = await setting();

    await take(s.lock, s.owner);

    const stored = JSON.parse((await keys.get(`job:lock:${s.job.id}`)) ?? '');
    expect(stored).toMatchObject({
      firstName: 'Ion',
      holderId: s.dinamo.owner,
      role: 'owner',
    });
    const ttl = await keys.ttl(`job:lock:${s.job.id}`);
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it('mirrors the holder on the job without moving its updated time', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await take(s.lock, s.hand);

    expect(await reread(s.job.id)).toMatchObject({
      lockHolderId: s.dinamo.plain,
      lockLastChangeAt: new Date(res.body.lastChangeAt),
      lockSince: new Date(res.body.since),
      updatedAt,
    });
  });

  it('refreshes the caller’s own lock, keeping since and moving the rest', async () => {
    const s = await setting();
    const first = await take(s.lock, s.hand);
    await settle();
    published = [];
    await new Promise((resolve) => setTimeout(resolve, 20));

    const again = await take(s.lock, s.hand);

    expect(again.status).toBe(200);
    expect(again.body.since).toBe(first.body.since);
    expect(Date.parse(again.body.lastChangeAt)).toBeGreaterThan(
      Date.parse(first.body.lastChangeAt),
    );
    expect(Date.parse(again.body.expiresAt)).toBe(
      Date.parse(again.body.lastChangeAt) + FIVE_MINUTES,
    );
    expect((await reread(s.job.id)).lockLastChangeAt).toEqual(
      new Date(again.body.lastChangeAt),
    );
    await settle();
    expect(changed(s.job.id)).toEqual([]);
  });

  it('refuses another person while one holds it, naming the holder', async () => {
    const s = await setting();
    const held = await take(s.lock, s.hand);

    const res = await take(s.lock, s.owner);

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({
      code: 'job_locked',
      holder: { firstName: 'Mihai', role: 'mechanic', since: held.body.since },
      message: expect.stringMatching(
        /^Blocat de Mihai, mecanic, de la \d\d:\d\d$/,
      ),
    });
    expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
  });

  it('publishes the take to the garage and the mechanic, never the driver', async () => {
    const s = await setting();

    await take(s.lock, s.owner);
    await settle();

    expect(changed(s.job.id)).toEqual([
      {
        audience: [
          `garage:${s.dinamo.garage.id}`,
          `mechanic:${s.dinamo.plainMechanic.id}`,
        ],
        event: expect.objectContaining({
          id: s.job.id,
          kind: 'job.lock_changed',
        }),
      },
    ]);
    expect(
      changed(s.job.id)
        .flatMap((m) => m.audience)
        .filter((a) => a.startsWith('account:')),
    ).toEqual([]);
  });

  it('publishes only to the garage for a job with no mechanic', async () => {
    const s = await setting();
    await prisma.job.update({
      data: { mechanicId: null },
      where: { id: s.job.id },
    });

    await take(s.lock, s.owner);
    await settle();

    expect(changed(s.job.id).map((m) => m.audience)).toEqual([
      [`garage:${s.dinamo.garage.id}`],
    ]);
  });

  it('writes no audit entry for a take', async () => {
    const s = await setting();

    await take(s.lock, s.owner);

    expect(
      await prisma.activityLog.count({ where: { subjectId: s.job.id } }),
    ).toBe(0);
  });
});

// @traces 395-FR-003 395-FR-008 395-FR-010
describe('DELETE /garage/jobs/:id/lock', () => {
  it('releases the holder’s lock, clears the mirror and publishes', async () => {
    const s = await setting();
    await take(s.lock, s.hand);
    await settle();
    published = [];

    const res = await send('delete', s.lock, s.hand);

    expect(res.status).toBe(204);
    expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(0);
    expect(await reread(s.job.id)).toMatchObject({
      lockHolderId: null,
      lockLastChangeAt: null,
      lockSince: null,
    });
    await settle();
    expect(changed(s.job.id)).toHaveLength(1);
  });

  it.each([
    ['owner', 'owner'],
    ['receptionist', 'desk'],
  ] as const)(
    'leaves another person’s lock alone when the %s asks without force',
    async (_, who) => {
      const s = await setting();
      await take(s.lock, s.hand);
      await settle();
      published = [];

      const res = await send('delete', s.lock, s[who]);

      expect(res.status).toBe(204);
      expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(1);
      expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
      await settle();
      expect(changed(s.job.id)).toEqual([]);
    },
  );

  it('answers a free job with nothing changed and nothing published', async () => {
    const s = await setting();

    const res = await send('delete', s.lock, s.hand);

    expect(res.status).toBe(204);
    await settle();
    expect(changed(s.job.id)).toEqual([]);
  });

  it('writes no audit entry for a release', async () => {
    const s = await setting();
    await take(s.lock, s.hand);

    await send('delete', s.lock, s.hand);

    expect(
      await prisma.activityLog.count({ where: { subjectId: s.job.id } }),
    ).toBe(0);
  });
});

// @traces 395-FR-003 395-FR-009 395-FR-010 395-FR-012
describe('the owner’s forced unlock', () => {
  const force = (path: string, auth: string) =>
    send('delete', `${path}?force=true`, auth);

  it('lifts another person’s lock and records who held it', async () => {
    const s = await setting();
    const held = await take(s.lock, s.hand);
    await settle();
    published = [];

    const res = await force(s.lock, s.owner);

    expect(res.status).toBe(204);
    expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(0);
    const job = await reread(s.job.id);
    expect(job).toMatchObject({
      lockForcedAt: expect.any(Date),
      lockForcedById: s.dinamo.owner,
      lockHolderId: null,
      lockSince: null,
    });
    await settle();
    expect(changed(s.job.id)).toHaveLength(1);

    const read = await get(`/garage/jobs/${s.job.id}`, s.hand);
    expect(read.body.lock).toBeNull();
    expect(read.body.lastForcedUnlock).toEqual({
      at: job.lockForcedAt?.toISOString(),
      by: { firstName: 'Ion', role: 'owner' },
      holderId: s.dinamo.plain,
    });
    expect(held.status).toBe(200);
  });

  it('writes one audit entry naming the former holder', async () => {
    const s = await setting();
    const held = await take(s.lock, s.hand);

    await force(s.lock, s.owner);

    const entries = await prisma.activityLog.findMany({
      where: { subjectId: s.job.id },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'update',
        actorId: s.dinamo.owner,
        actorRole: 'owner',
        field: 'lock_holder_id',
        garageId: s.dinamo.garage.id,
        internal: true,
        jobId: s.job.id,
        kind: 'job.lock_forced',
        newValue: null,
        oldValue: s.dinamo.plain,
        subjectType: 'job',
        text: `Mihai, mecanic, de la ${held.body.since}`,
      }),
    ]);
  });

  it('keeps the record when another person takes the job after the force', async () => {
    const s = await setting();
    await take(s.lock, s.hand);
    await force(s.lock, s.owner);

    await take(s.lock, s.owner);

    expect((await reread(s.job.id)).lockForcedById).toBe(s.dinamo.owner);
  });

  it('clears the record once the former holder takes the job again', async () => {
    const s = await setting();
    await take(s.lock, s.hand);
    await force(s.lock, s.owner);

    await take(s.lock, s.hand);

    expect(await reread(s.job.id)).toMatchObject({
      lockForcedAt: null,
      lockForcedById: null,
    });
  });

  it.each([
    ['receptionist', 'desk'],
    ['mechanic', 'hand'],
  ] as const)('refuses a %s asking to force', async (_, who) => {
    const s = await setting();
    await take(s.lock, s.owner);

    const res = await force(s.lock, s[who]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.owner);
  });
});

// @traces 395-FR-004 395-FR-018
describe('a job-changing request', () => {
  const add = (jobId: string, auth: string, text: string) =>
    send(
      'post',
      `/garage/jobs/${jobId}/steps`,
      auth,
      { text },
      {
        'Idempotency-Key': `${jobId}-${text}`,
      },
    );

  // Each route a job changes through, with a body it accepts.
  const routes = (jobId: string, stepId: string) =>
    [
      ['post', `/garage/jobs/${jobId}/start`, undefined],
      ['post', `/garage/jobs/${jobId}/pause`, undefined],
      ['post', `/garage/jobs/${jobId}/resume`, undefined],
      ['post', `/garage/jobs/${jobId}/finish`, undefined],
      ['post', `/garage/jobs/${jobId}/receive`, { odometerKm: 120_000 }],
      ['post', `/garage/jobs/${jobId}/handover`, { finalPriceBani: 50_000 }],
      [
        'patch',
        `/garage/jobs/${jobId}/final-price`,
        { finalPriceBani: 50_000 },
      ],
      ['put', `/garage/jobs/${jobId}/steps/order`, { stepIds: [stepId] }],
      [
        'patch',
        `/garage/jobs/${jobId}/steps/${stepId}`,
        { text: 'Probă pe drum' },
      ],
      ['put', `/garage/jobs/${jobId}/steps/${stepId}/done`, { done: true }],
      ['delete', `/garage/jobs/${jobId}/steps/${stepId}`, undefined],
    ] as const;

  it('meets the holder’s lock on every route, with the holder named', async () => {
    const s = await setting();
    const step = await add(s.job.id, s.owner, 'Etriere demontate');
    expect(step.status).toBe(201);
    await take(s.lock, s.hand);

    for (const [method, path, body] of routes(s.job.id, step.body.id)) {
      const res = await send(method, path, s.owner, body);
      expect([path, res.status, res.body.code]).toEqual([
        path,
        423,
        'job_locked',
      ]);
      expect(res.body.holder).toMatchObject({
        firstName: 'Mihai',
        role: 'mechanic',
      });
    }
    const added = await add(s.job.id, s.owner, 'Lichid verificat');
    expect([added.status, added.body.code]).toEqual([423, 'job_locked']);
    expect((await reread(s.job.id)).status).toBe('to_do');
  });

  it('takes and releases the lock around a one-tap change', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await send('post', `/garage/jobs/${s.job.id}/start`, s.hand);

    expect(res.status).toBe(200);
    expect(res.body.lock).toBeNull();
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThan(updatedAt.getTime());
    expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(0);
    expect(await reread(s.job.id)).toMatchObject({
      lockHolderId: null,
      status: 'in_work',
    });
    await settle();
    expect(changed(s.job.id).length).toBeGreaterThanOrEqual(1);
  });

  it('uses the caller’s own lock and releases it with the change', async () => {
    const s = await setting();
    await take(s.lock, s.hand);

    const res = await send('post', `/garage/jobs/${s.job.id}/start`, s.hand);

    expect(res.status).toBe(200);
    expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(0);
    expect((await reread(s.job.id)).lockHolderId).toBeNull();
  });

  it('releases a lock the request took when the change is refused', async () => {
    const s = await setting();

    const res = await send('post', `/garage/jobs/${s.job.id}/finish`, s.hand);

    expect(res.status).toBe(409);
    expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(0);
    expect((await reread(s.job.id)).lockHolderId).toBeNull();
  });

  it('keeps a lock the caller held before a refused change', async () => {
    const s = await setting();
    await take(s.lock, s.hand);

    const res = await send('post', `/garage/jobs/${s.job.id}/finish`, s.hand);

    expect(res.status).toBe(409);
    expect(await keys.exists(`job:lock:${s.job.id}`)).toBe(1);
    expect((await reread(s.job.id)).lockHolderId).toBe(s.dinamo.plain);
  });
});
