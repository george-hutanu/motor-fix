import { Redis } from 'ioredis';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, send, team, world } = quotesApp();
const { prisma } = world;

const subscriber = new Redis(
  process.env['REDIS_URL'] ?? 'redis://localhost:6379',
);
const audiences: string[][] = [];

beforeAll(async () => {
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message: string) =>
    audiences.push(JSON.parse(message).audience),
  );
});

afterAll(() => subscriber.disconnect());

async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const admin = await world.account('Elena Admin', ['admin']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'to_do',
    { mechanicId: dinamo.plainMechanic.id },
  );
  return {
    admin: bearer(admin, 'admin'),
    andrei,
    desk: bearer(dinamo.receptionist, 'receptionist'),
    driver: bearer(andrei, 'driver'),
    hand: bearer(dinamo.plain, 'mechanic'),
    job,
    lock: `/garage/jobs/${job.id}/lock`,
    offJob: bearer(dinamo.answering, 'mechanic'),
    owner: bearer(dinamo.owner, 'garage'),
    stranger: bearer(militari.owner, 'garage'),
  };
}

const held = async (jobId: string) =>
  (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).lockHolderId;

// @traces 395-FR-002 395-FR-018
describe('who may take a job’s lock', () => {
  it.each(['reception', 'handover'])(
    'lets the receptionist take it for %s',
    async (purpose) => {
      const s = await setting();

      const res = await send('post', s.lock, s.desk, { purpose });

      expect(res.status).toBe(200);
      expect(res.body.holder.role).toBe('receptionist');
    },
  );

  it.each([['edit'], [undefined]])(
    'refuses the receptionist an edit (purpose %s)',
    async (purpose) => {
      const s = await setting();

      const res = await send(
        'post',
        s.lock,
        s.desk,
        purpose ? { purpose } : undefined,
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
      expect(await held(s.job.id)).toBeNull();
    },
  );

  it('refuses a mechanic of the garage who is not on the job', async () => {
    const s = await setting();

    const res = await send('post', s.lock, s.offJob);

    expect(res.status).toBe(403);
    expect(await held(s.job.id)).toBeNull();
  });

  it.each([
    ['another garage', 'stranger'],
    ['a driver', 'driver'],
    ['an admin', 'admin'],
  ] as const)('answers %s as if the job did not exist', async (_, who) => {
    const s = await setting();

    for (const res of [
      await send('post', s.lock, s[who]),
      await send('delete', s.lock, s[who]),
      await send('delete', `${s.lock}?force=true`, s[who]),
    ]) {
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
    expect(await held(s.job.id)).toBeNull();
  });

  it('answers an unknown job 404 before a refused role', async () => {
    const s = await setting();
    const missing = '/garage/jobs/7a1c6a4e-6f1b-4b4e-9a53-0c1b2d3e4f50/lock';

    const res = await send('post', missing, s.desk, { purpose: 'edit' });

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it('refuses a purpose it does not know', async () => {
    const s = await setting();

    const res = await send('post', s.lock, s.owner, { purpose: 'anything' });

    expect(res.status).toBe(400);
  });

  it('answers a free lock, released twice, the same each time', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);

    const first = await send('delete', s.lock, s.hand);
    const second = await send('delete', s.lock, s.hand);

    expect([first.status, second.status]).toEqual([204, 204]);
  });

  it('lets a later holder take it once the force has lifted the first', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await send('delete', `${s.lock}?force=true`, s.owner);

    const stale = await send('delete', s.lock, s.hand);
    const next = await send('post', s.lock, s.owner);

    expect(stale.status).toBe(204);
    expect(next.status).toBe(200);
  });

  it('never sends a lock change to the driver’s channel', async () => {
    const s = await setting();
    await send('post', s.lock, s.hand);
    await send('delete', `${s.lock}?force=true`, s.owner);
    await send('post', s.lock, s.owner);
    await send('delete', s.lock, s.owner);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(audiences.flat()).not.toContain(`account:${s.andrei}`);
    expect(audiences.flat().filter((a) => a.startsWith('account:'))).toEqual(
      [],
    );
  });
});
