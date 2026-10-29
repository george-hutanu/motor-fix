import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

const HOUR = 3_600_000;

async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const chain = await world.chain(andrei, dinamo.garage.id, {
    booking: 'confirmed',
    request: 'done',
  });
  const created = await world.job(chain.booking.id, 'done');
  const job = await prisma.job.update({
    data: { mechanicId: dinamo.plainMechanic.id, receivedAt: new Date() },
    where: { id: created.id },
  });
  return {
    andrei,
    driver: bearer(andrei, 'driver'),
    job,
    owner: bearer(dinamo.owner, 'garage'),
    requestId: chain.request.id,
  };
}

const handover = (id: string, auth: string, body: object) =>
  send('post', `/garage/jobs/${id}/handover`, auth, body);
const correct = (id: string, auth: string, body: object) =>
  send('patch', `/garage/jobs/${id}/final-price`, auth, body);
const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

// @traces 406-FR-001 406-FR-003 406-FR-011
describe('final price routes under hostile input', () => {
  it('records the lowest price allowed, one bani', async () => {
    const s = await setting();
    const res = await handover(s.job.id, s.owner, { finalPriceBani: 1 });
    expect(res.status).toBe(200);
    expect(res.body.finalPriceBani).toBe(1);
  });

  it.each([[true], [[]], [{}], [''], [1e21], [-0.0001], ['1e3']])(
    'refuses the price %j with 400 and records nothing',
    async (finalPriceBani) => {
      const s = await setting();
      const res = await handover(s.job.id, s.owner, { finalPriceBani });
      expect(res.status).toBe(400);
      expect((await reread(s.job.id)).handedOverAt).toBeNull();
    },
  );

  it('refuses a JSON array as the body with 400', async () => {
    const s = await setting();
    const res = await handover(s.job.id, s.owner, [] as unknown as object);
    expect(res.status).toBe(400);
    expect((await reread(s.job.id)).handedOverAt).toBeNull();
  });

  it('answers 404 for an unknown job and never 500 for a malformed id', async () => {
    const s = await setting();
    const unknown = await handover(
      '00000000-0000-4000-8000-000000000000',
      s.owner,
      { finalPriceBani: 1 },
    );
    const malformed = await handover('not-a-uuid', s.owner, {
      finalPriceBani: 1,
    });
    const patched = await correct('not-a-uuid', s.owner, { finalPriceBani: 1 });
    expect(unknown.status).toBe(404);
    expect([400, 404]).toContain(malformed.status);
    expect([400, 404]).toContain(patched.status);
  });

  it('refuses a driver and an unsigned call without recording', async () => {
    const s = await setting();
    const asDriver = await handover(s.job.id, s.driver, { finalPriceBani: 1 });
    const anonymous = await handover(s.job.id, 'Bearer nonsense', {
      finalPriceBani: 1,
    });
    expect([403, 404]).toContain(asDriver.status);
    expect(anonymous.status).toBe(401);
    expect((await reread(s.job.id)).handedOverAt).toBeNull();
  });

  it('leaves who recorded the price and when it was corrected out of the answer', async () => {
    const s = await setting();
    const first = await handover(s.job.id, s.owner, { finalPriceBani: 100 });
    const second = await correct(s.job.id, s.owner, { finalPriceBani: 200 });
    for (const body of [first.body, second.body]) {
      expect(Object.keys(body)).not.toContain('finalPriceRecordedById');
      expect(Object.keys(body)).not.toContain('finalPriceRecordedBy');
      expect(Object.keys(body)).not.toContain('finalPriceCorrectedAt');
    }
  });
});

// @traces 406-FR-005 406-FR-006 406-FR-011
describe('corrections at the edges of the window', () => {
  async function handedOver(hoursAgo: number, ms = 0) {
    const s = await setting();
    expect(
      (await handover(s.job.id, s.owner, { finalPriceBani: 125_000 })).status,
    ).toBe(200);
    await prisma.job.update({
      data: { handedOverAt: new Date(Date.now() - hoursAgo * HOUR - ms) },
      where: { id: s.job.id },
    });
    return s;
  }

  it('still corrects one minute before 48 hours', async () => {
    const s = await handedOver(48, -60_000);
    const res = await correct(s.job.id, s.owner, { finalPriceBani: 115_000 });
    expect(res.status).toBe(200);
    expect((await reread(s.job.id)).finalPriceBani).toBe(115_000);
  });

  it('corrects down to one bani and up to the limit', async () => {
    const s = await handedOver(1);
    expect(
      (await correct(s.job.id, s.owner, { finalPriceBani: 1 })).status,
    ).toBe(200);
    expect(
      (await correct(s.job.id, s.owner, { finalPriceBani: 100_000_000 }))
        .status,
    ).toBe(200);
    expect((await reread(s.job.id)).finalPriceBani).toBe(100_000_000);
  });

  it('chains the audit entries of two simultaneous corrections', async () => {
    const s = await handedOver(1);
    const [a, b] = await Promise.all([
      correct(s.job.id, s.owner, { finalPriceBani: 111_000 }),
      correct(s.job.id, s.owner, { finalPriceBani: 222_000 }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const events = await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: { kind: 'job.final_price_corrected', subjectId: s.job.id },
    });
    expect(events).toHaveLength(2);
    const [first, second] = events.map(
      (e) => e.payload as { oldBani: number; newBani: number },
    );
    expect(first.oldBani).toBe(125_000);
    expect(second.oldBani).toBe(first.newBani);
    expect((await reread(s.job.id)).finalPriceBani).toBe(second.newBani);
  });

  it('shows another driver nothing of the price', async () => {
    const s = await setting();
    await handover(s.job.id, s.owner, { finalPriceBani: 125_000 });
    const other = await world.account('Ion Pop', ['driver']);
    const list = await get('/requests', bearer(other, 'driver'));
    const one = await get(`/requests/${s.requestId}`, bearer(other, 'driver'));
    expect(JSON.stringify(list.body)).not.toContain('125000');
    expect([403, 404]).toContain(one.status);
  });
});
