import { quotesApp } from '../quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

// Andrei's request, booked at Atelier Dinamo, its job done.
async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const { booking, request } = await world.chain(andrei, dinamo.garage.id, {
    request: 'done',
  });
  const job = await world.job(booking.id, 'done');
  return {
    driver: bearer(andrei, 'driver'),
    job,
    owner: bearer(dinamo.owner, 'garage'),
    requestId: request.id,
  };
}

type Setting = Awaited<ReturnType<typeof setting>>;

// The booking as the driver's list and the request's own page show it.
async function seen(s: Setting) {
  const list = await get('/requests', s.driver);
  const one = await get(`/requests/${s.requestId}`, s.driver);
  expect(list.status).toBe(200);
  expect(one.status).toBe(200);
  const row = list.body.items.find((i: { id: string }) => i.id === s.requestId);
  return { page: one.body.booking, row: row.booking };
}

// @traces 406-FR-008 406-FR-011
describe('the final price on the driver’s requests', () => {
  it('shows no price before the handover', async () => {
    const s = await setting();

    const { page, row } = await seen(s);

    for (const booking of [row, page]) {
      expect(booking).toMatchObject({
        finalPriceBani: null,
        handedOverAt: null,
      });
    }
  });

  it('shows the price recorded and when, after the handover', async () => {
    const s = await setting();
    const res = await send(
      'post',
      `/garage/jobs/${s.job.id}/handover`,
      s.owner,
      { finalPriceBani: 125_000 },
    );
    expect(res.status).toBe(200);
    const { handedOverAt } = await prisma.job.findUniqueOrThrow({
      where: { id: s.job.id },
    });

    const { page, row } = await seen(s);

    for (const booking of [row, page]) {
      expect(booking).toMatchObject({
        finalPriceBani: 125_000,
        handedOverAt: handedOverAt?.toISOString(),
      });
    }
  });

  it('shows the corrected price after a correction', async () => {
    const s = await setting();
    await send('post', `/garage/jobs/${s.job.id}/handover`, s.owner, {
      finalPriceBani: 125_000,
    });
    const res = await send(
      'patch',
      `/garage/jobs/${s.job.id}/final-price`,
      s.owner,
      { finalPriceBani: 115_000 },
    );
    expect(res.status).toBe(200);

    const { page, row } = await seen(s);

    for (const booking of [row, page]) {
      expect(booking).toMatchObject({ finalPriceBani: 115_000 });
    }
  });
});
