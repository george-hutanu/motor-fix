import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

const INT_MAX = 2_147_483_647;

async function setting(
  status: JobStatus,
  bounds: [number, number] = [89_000, 140_000],
  received = true,
) {
  const driver = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const chain = await world.chain(driver, dinamo.garage.id, {
    request:
      status === 'to_do' ? 'booked' : status === 'done' ? 'done' : 'in_work',
  });
  await prisma.quote.update({
    data: { fromBani: bounds[0], toBani: bounds[1] },
    where: { id: chain.quote.id },
  });
  const created = await world.job(chain.booking.id, status);
  const job = await prisma.job.update({
    data: {
      mechanicId: dinamo.plainMechanic.id,
      receivedAt: received ? new Date() : null,
    },
    where: { id: created.id },
  });
  return { chain, dinamo, job, owner: bearer(dinamo.owner, 'garage') };
}

const RANGE = { quoteFromBani: 89_000, quoteToBani: 140_000 };

// @traces 1404-FR-001
describe('the quote range on the stage moves', () => {
  it.each([
    ['start', 'to_do', {}],
    ['pause', 'in_work', {}],
    ['resume', 'paused', {}],
    ['finish', 'in_work', {}],
  ] as const)('answers %s with the range', async (verb, status, body) => {
    const s = await setting(status);

    const res = await send(
      'post',
      `/garage/jobs/${s.job.id}/${verb}`,
      s.owner,
      body,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(RANGE);
  });

  it('answers receive with the range', async () => {
    const s = await setting('to_do', [89_000, 140_000], false);

    const res = await send(
      'post',
      `/garage/jobs/${s.job.id}/receive`,
      s.owner,
      {
        odometerKm: 86_500,
      },
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(RANGE);
  });

  it('answers handover and a price correction with the range', async () => {
    const s = await setting('done');

    const handed = await send(
      'post',
      `/garage/jobs/${s.job.id}/handover`,
      s.owner,
      {
        finalPriceBani: 125_000,
      },
    );
    const fixed = await send(
      'patch',
      `/garage/jobs/${s.job.id}/final-price`,
      s.owner,
      {
        finalPriceBani: 130_000,
      },
    );

    expect(handed.status).toBe(200);
    expect(handed.body).toMatchObject({ ...RANGE, finalPriceBani: 125_000 });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ ...RANGE, finalPriceBani: 130_000 });
  });

  it('keeps the range when the final price is above the quote', async () => {
    const s = await setting('done');

    const res = await send(
      'post',
      `/garage/jobs/${s.job.id}/handover`,
      s.owner,
      {
        finalPriceBani: 900_000,
      },
    );

    expect(res.body).toMatchObject({ ...RANGE, finalPriceBani: 900_000 });
  });
});

// @traces 1404-FR-001
// @traces 1404-FR-002
describe('the quote range as stored', () => {
  it.each([
    [0, 0],
    [1, 1],
    [INT_MAX, INT_MAX],
    [0, INT_MAX],
  ] as const)('passes %i to %i through unchanged', async (from, to) => {
    const s = await setting('done', [from, to]);

    const res = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(res.status).toBe(200);
    expect(res.body.quoteFromBani).toBe(from);
    expect(res.body.quoteToBani).toBe(to);
    expect(Number.isInteger(res.body.quoteFromBani)).toBe(true);
  });

  it('reads the quote row again on every call', async () => {
    const s = await setting('done');
    await get(`/garage/jobs/${s.job.id}`, s.owner);
    await prisma.quote.update({
      data: { fromBani: 50_000, toBani: 60_000 },
      where: { id: s.chain.quote.id },
    });

    const res = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(res.body).toMatchObject({
      quoteFromBani: 50_000,
      quoteToBani: 60_000,
    });
  });

  it('answers the same body twice', async () => {
    const s = await setting('done');

    const a = await get(`/garage/jobs/${s.job.id}`, s.owner);
    const b = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(b.body).toEqual(a.body);
  });

  it('does not mix up the ranges of two jobs of one garage', async () => {
    const s = await setting('done', [10_000, 20_000]);
    const driver = await world.account('Ioana Pop', ['driver']);
    const chain = await world.chain(driver, s.dinamo.garage.id, {
      request: 'done',
    });
    await prisma.quote.update({
      data: { fromBani: 30_000, toBani: 40_000 },
      where: { id: chain.quote.id },
    });
    const second = await world.job(chain.booking.id, 'done');

    const a = await get(`/garage/jobs/${s.job.id}`, s.owner);
    const b = await get(`/garage/jobs/${second.id}`, s.owner);

    expect([a.body.quoteFromBani, a.body.quoteToBani]).toEqual([
      10_000, 20_000,
    ]);
    expect([b.body.quoteFromBani, b.body.quoteToBani]).toEqual([
      30_000, 40_000,
    ]);
  });
});

// @traces 1404-FR-001
describe('refusals on the job read', () => {
  it('answers an unknown id with 404 and no range', async () => {
    const s = await setting('done');

    const res = await get(
      '/garage/jobs/00000000-0000-4000-8000-000000000000',
      s.owner,
    );

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('quoteFromBani');
  });

  it('answers a malformed id with a client error and no range', async () => {
    const s = await setting('done');

    const res = await get('/garage/jobs/not-a-uuid', s.owner);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).not.toHaveProperty('quoteFromBani');
  });

  it('answers a visitor with 401 and no range', async () => {
    const s = await setting('done');

    const res = await get(`/garage/jobs/${s.job.id}`);

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('quoteToBani');
  });

  it('refuses a driver token on the garage read', async () => {
    const s = await setting('done');
    const driver = await world.account('Mihai Ene', ['driver']);

    const res = await get(`/garage/jobs/${s.job.id}`, bearer(driver, 'driver'));

    expect(res.status).toBeGreaterThanOrEqual(403);
    expect(res.body).not.toHaveProperty('quoteToBani');
  });
});

// @traces 1404-FR-003
describe('the job list', () => {
  it('stays free of the range with several jobs and a page limit', async () => {
    const s = await setting('done');

    const res = await get('/garage/jobs?limit=1', s.owner);

    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(Object.keys(item)).not.toEqual(
        expect.arrayContaining(['quoteFromBani']),
      );
      expect(item).not.toHaveProperty('quoteToBani');
    }
  });
});
