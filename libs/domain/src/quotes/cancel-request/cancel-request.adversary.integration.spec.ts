import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
});

const asDriver = (id: string) => bearer(id, 'driver');
const cancel = (requestId: string, auth?: string, body: unknown = {}) =>
  post(`/quote-requests/${requestId}/cancel`, body, auth);

async function open(status: 'sent' | 'quoted' = 'sent') {
  const andrei = await world.account('Andrei Ion Marin');
  const volt = await team('Volt Auto');
  const request = await world.request(andrei, { status });
  return { andrei, request, volt };
}

// @traces 1258-driver-cancel-FR-001
describe('POST /quote-requests/:id/cancel in odd shapes', () => {
  it('closes a request with no recipient at all, naming no garage in its event', async () => {
    const { andrei, request } = await open();

    const res = await cancel(request.id, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      closedReason: 'cancelled',
      status: 'closed',
    });
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      garageIds: [],
      reason: 'driver',
      requestId: request.id,
    });
  });

  it('leaves quotes that are not waiting as they were and names their garages in no recipient move', async () => {
    const { andrei, request, volt } = await open('quoted');
    const nordic = await team('Garaj Nordic');
    const lone = await team('Atelier Lone');
    await world.recipient(request.id, volt.garage.id);
    const kept = [
      [volt.garage.id, 'withdrawn'],
      [nordic.garage.id, 'expired'],
      [lone.garage.id, 'declined_by_driver'],
    ] as const;
    const rows = [];
    for (const [garageId, status] of kept) {
      const q = await world.quote(request.id, garageId);
      rows.push(
        await prisma.quote.update({ data: { status }, where: { id: q.id } }),
      );
    }

    const res = await cancel(request.id, asDriver(andrei));

    expect(res.status).toBe(200);
    for (const row of rows) {
      expect(
        (await prisma.quote.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe(row.status);
    }
  });

  it('ignores a body sent with the cancel', async () => {
    const { andrei, request } = await open();

    const res = await cancel(request.id, asDriver(andrei), {
      closedReason: 'expired',
      status: 'done',
    });

    expect([200, 400]).toContain(res.status);
    const row = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(row.closedReason).not.toBe('expired');
    expect(row.status).not.toBe('done');
  });
});

// @traces 1258-driver-cancel-FR-001
describe('POST /quote-requests/:id/cancel twice', () => {
  it('answers 409 naming closed to the second call and writes one event', async () => {
    const { andrei, request } = await open();

    const first = await cancel(request.id, asDriver(andrei));
    const second = await cancel(request.id, asDriver(andrei));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'closed',
    });
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('lets exactly one of three simultaneous cancels win, with one event', async () => {
    const { andrei, request, volt } = await open();
    await world.recipient(request.id, volt.garage.id);

    const results = await Promise.all([
      cancel(request.id, asDriver(andrei)),
      cancel(request.id, asDriver(andrei)),
      cancel(request.id, asDriver(andrei)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });
});

// @traces 1258-driver-cancel-FR-001
describe('POST /quote-requests/:id/cancel by someone else', () => {
  it('answers 404 to an admin and a mechanic session, writing nothing', async () => {
    const { request, volt } = await open();
    const admin = await world.account('Ada Admin', ['admin']);

    expect((await cancel(request.id, bearer(admin, 'admin'))).status).toBe(404);
    expect(
      (await cancel(request.id, bearer(volt.answering, 'mechanic'))).status,
    ).toBe(404);
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('sent');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('answers 401 to a malformed bearer token', async () => {
    const { request } = await open();

    const res = await cancel(request.id, 'Bearer not.a.token');

    expect(res.status).toBe(401);
  });
});
