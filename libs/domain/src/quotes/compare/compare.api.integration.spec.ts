import { randomUUID } from 'node:crypto';

import { CompareService } from './compare.service';
import type { Actor } from '../../auth/policy';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

const asDriver = (id: string) => bearer(id, 'driver');
const compare = (requestId: string, auth?: string) =>
  get(`/quote-requests/${requestId}/quotes`, auth);

const driverActor = (accountId: string, over: Partial<Actor> = {}): Actor => ({
  accountId,
  garageId: null,
  language: 'ro',
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
  ...over,
});

// Andrei's request, quoted by Atelier Dinamo.
async function quoted() {
  const andrei = await world.account('Andrei Ion Marin');
  const dinamo = await team('Atelier Dinamo');
  const request = await world.request(andrei, { status: 'quoted' });
  const quote = await world.quote(request.id, dinamo.garage.id);
  return { andrei, dinamo, quote, request };
}

// @traces 313-FR-001
// @traces 313-FR-002
// @traces 313-FR-017
describe('GET /quote-requests/:id/quotes', () => {
  it('answers 401 sign_in_required without a token', async () => {
    const { request } = await quoted();

    const res = await compare(request.id);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('gives the driver the request, the rows and the garages behind them', async () => {
    const { andrei, dinamo, quote, request } = await quoted();
    await prisma.garage.update({
      data: {
        businessKind: 'company',
        cityKey: 'bucuresti',
        cityName: 'București',
        phone: '+40722000111',
        rating: 4.7,
        reviewCount: 31,
      },
      where: { id: dinamo.garage.id },
    });
    const [asked] = await prisma.requestJob.findMany({
      include: { jobType: true },
      where: { requestId: request.id },
    });
    await prisma.quote.update({
      data: { changedAt: minutesAgo(10), note: 'Verific și filtrul' },
      where: { id: quote.id },
    });
    await prisma.quoteJob.create({
      data: { included: true, quoteId: quote.id, requestJobId: asked.id },
    });

    const res = await compare(request.id, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body.request).toEqual({
      booking: null,
      car: {
        brand: 'Mini',
        engine: '2.0 turbo',
        fuel: 'petrol',
        model: 'Cooper S',
        year: 2019,
      },
      description: 'Scârțâie la frânare',
      id: request.id,
      jobs: [
        {
          id: asked.id,
          jobTypeId: asked.jobTypeId,
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          position: 0,
        },
      ],
      status: 'quoted',
    });
    const updated = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(res.body.quotes).toEqual([
      {
        changedAt: updated.changedAt?.toISOString(),
        durationMinutes: 90,
        expiresAt: quote.expiresAt.toISOString(),
        fromBani: 45_000,
        garage: {
          area: 'București',
          id: dinamo.garage.id,
          mobile: false,
          name: 'Atelier Dinamo',
          rating: 4.7,
          reviewCount: 31,
          slug: dinamo.garage.slug,
        },
        id: quote.id,
        jobs: [
          {
            included: true,
            nameEn: 'Oil change',
            nameRo: 'Schimb ulei',
            requestJobId: asked.id,
          },
        ],
        note: 'Verific și filtrul',
        sentAt: quote.sentAt.toISOString(),
        slot: quote.slot.toISOString(),
        status: 'waiting',
        toBani: 60_000,
      },
    ]);
    expect(res.body).toMatchObject({
      declined: [],
      waiting: [],
      withdrawn: [],
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('+40722000111');
    expect(body).not.toContain('B123ABC');
    expect(body).not.toContain('plate');
    expect(body).not.toContain('@');
  });

  it('answers the description’s first line only', async () => {
    const andrei = await world.account('Andrei Marin');
    const { garage } = await team('Atelier Dinamo');
    const request = await world.request(andrei, {
      description: 'Scârțâie la frânare\nmai ales dimineața',
      status: 'quoted',
    });
    await world.quote(request.id, garage.id);

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.request.description).toBe('Scârțâie la frânare');
  });

  it('reads an unreviewed garage as null with no reviews, a mobile mechanic as mobile, and an unknown city as null', async () => {
    const { andrei, dinamo, request } = await quoted();
    await prisma.garage.update({
      data: { businessKind: 'mobile' },
      where: { id: dinamo.garage.id },
    });

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.quotes[0].garage).toMatchObject({
      area: null,
      mobile: true,
      rating: null,
      reviewCount: 0,
    });
  });

  it('marks a job the quote left out as not included, with its names', async () => {
    const { andrei, quote, request } = await quoted();
    const [asked] = await prisma.requestJob.findMany({
      where: { requestId: request.id },
    });
    const brakes = await world.jobType('Plăcuțe frână', 'Brake pads');
    const second = await prisma.requestJob.create({
      data: { jobTypeId: brakes.id, position: 1, requestId: request.id },
    });
    await prisma.quoteJob.createMany({
      data: [
        { included: true, quoteId: quote.id, requestJobId: asked.id },
        { included: false, quoteId: quote.id, requestJobId: second.id },
      ],
    });

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.quotes[0].jobs).toEqual([
      {
        included: true,
        nameEn: 'Oil change',
        nameRo: 'Schimb ulei',
        requestJobId: asked.id,
      },
      {
        included: false,
        nameEn: 'Brake pads',
        nameRo: 'Plăcuțe frână',
        requestJobId: second.id,
      },
    ]);
  });

  it('carries the newest booking’s status and deadline', async () => {
    const { andrei, quote, request } = await quoted();
    const booking = await world.booking(quote.id, 'awaiting_confirmation');

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.request.booking).toEqual({
      confirmBy: booking.confirmBy.toISOString(),
      status: 'awaiting_confirmation',
    });
  });

  it('answers 400 to an id that is not a uuid', async () => {
    const andrei = await world.account('Andrei Marin');

    const res = await compare('not-an-id', asDriver(andrei));

    expect(res.status).toBe(400);
  });
});

// @traces 313-FR-003
describe('GET /quote-requests/:id/quotes order', () => {
  it('lists the rows fastest answer first, equal times by id', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const garages = await Promise.all(
      ['Atelier Dinamo', 'Service Militari', 'Garaj Est', 'Volt Auto'].map(
        (name) => world.garage(name),
      ),
    );
    const quotes = [];
    for (const garage of garages) {
      quotes.push(await world.quote(request.id, garage.id));
    }
    const [late, a, b, early] = quotes;
    const same = minutesAgo(20);
    await prisma.quote.update({
      data: { sentAt: minutesAgo(5) },
      where: { id: late.id },
    });
    await prisma.quote.updateMany({
      data: { sentAt: same },
      where: { id: { in: [a.id, b.id] } },
    });
    await prisma.quote.update({
      data: { sentAt: minutesAgo(30) },
      where: { id: early.id },
    });

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.quotes.map((q: { id: string }) => q.id)).toEqual([
      early.id,
      ...[a.id, b.id].sort(),
      late.id,
    ]);
  });
});

// @traces 313-FR-002
// @traces 313-FR-009
describe('GET /quote-requests/:id/quotes by status', () => {
  it('gives every status but withdrawn a row, and the withdrawn ones a line with why', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const rows: Record<string, string> = {};
    for (const status of [
      'waiting',
      'lost',
      'expired',
      'declined_by_driver',
    ] as const) {
      const garage = await world.garage(`Garaj ${status}`);
      rows[status] = (await world.quote(request.id, garage.id, status)).id;
    }
    const volt = await world.garage('Volt Auto');
    await world.quote(request.id, volt.id, 'withdrawn');
    const est = await world.garage('Garaj Est');
    const suspendedQuote = await world.quote(request.id, est.id);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: est.id },
    });

    const res = await compare(request.id, asDriver(andrei));

    expect(
      Object.fromEntries(
        res.body.quotes.map((q: { id: string; status: string }) => [
          q.status,
          q.id,
        ]),
      ),
    ).toEqual(rows);
    expect(res.body.quotes).toHaveLength(4);
    expect(res.body.quotes.map((q: { id: string }) => q.id)).not.toContain(
      suspendedQuote.id,
    );
    expect(res.body.withdrawn).toEqual(
      expect.arrayContaining([
        { garageName: 'Volt Auto', reason: 'garage' },
        { garageName: 'Garaj Est', reason: 'suspended' },
      ]),
    );
    expect(res.body.withdrawn).toHaveLength(2);
  });

  it('gives an accepted quote its row', async () => {
    const andrei = await world.account('Andrei Marin');
    const { garage } = await team('Atelier Dinamo');
    const { quote, request } = await world.chain(andrei, garage.id);

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.quotes).toMatchObject([
      { id: quote.id, status: 'accepted' },
    ]);
  });

  it('answers no rows and the withdrawn lines when every quote was withdrawn', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const volt = await world.garage('Volt Auto');
    await world.quote(request.id, volt.id, 'withdrawn');

    const res = await compare(request.id, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
    expect(res.body.withdrawn).toEqual([
      { garageName: 'Volt Auto', reason: 'garage' },
    ]);
  });
});

// @traces 313-FR-002
// @traces 313-FR-009
describe('GET /quote-requests/:id/quotes declines and waiting garages', () => {
  async function declinedAgo(ms: number) {
    const { andrei, request } = await quoted();
    const est = await team('Garaj Est');
    const recipient = await world.recipient(
      request.id,
      est.garage.id,
      'declined',
      est.receptionist,
    );
    const at = new Date(Date.now() - ms);
    await prisma.requestRecipient.update({
      data: {
        answeredAt: at,
        declinedAt: at,
        declineReason: 'make_model_engine_not_done',
      },
      where: { id: recipient.id },
    });
    return { andrei, est, recipient, request };
  }

  it('shows a decline only once its undo window has passed, with its reason and never who declined', async () => {
    const { andrei, est, request } = await declinedAgo(5 * 60_000);

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.declined).toEqual([
      { declineReason: 'make_model_engine_not_done', garageName: 'Garaj Est' },
    ]);
    expect(res.body.waiting).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(est.receptionist);
  });

  it('reads a decline still inside its undo window as a garage not yet answered', async () => {
    const { andrei, request } = await declinedAgo(4 * 60_000 + 59_000);

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.declined).toEqual([]);
    expect(res.body.waiting).toEqual(['Garaj Est']);
  });

  it('drops an undone decline', async () => {
    const { andrei, recipient, request } = await declinedAgo(10 * 60_000);
    await prisma.requestRecipient.update({
      data: {
        answeredAt: null,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
        status: 'waiting',
      },
      where: { id: recipient.id },
    });

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.declined).toEqual([]);
    expect(res.body.waiting).toEqual(['Garaj Est']);
  });

  it('names the garages that have not answered, and not the ones that quoted', async () => {
    const { andrei, request } = await quoted();
    const militari = await world.garage('Service Militari');
    await world.recipient(request.id, militari.id);

    const res = await compare(request.id, asDriver(andrei));

    expect(res.body.waiting).toEqual(['Service Militari']);
  });
});

// @traces 313-FR-001
// @traces 313-FR-017
describe('GET /quote-requests/:id/quotes for anyone but the driver', () => {
  it('answers 404 to another driver, naming nothing of the request', async () => {
    const { request } = await quoted();
    const maria = await world.account('Maria Ionescu');

    const res = await compare(request.id, asDriver(maria));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(request.id);
    expect(JSON.stringify(res.body)).not.toContain('Atelier Dinamo');
  });

  it('answers 404 to the quoting garage’s owner', async () => {
    const { dinamo, request } = await quoted();

    const res = await compare(request.id, bearer(dinamo.owner, 'garage'));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(request.id);
  });

  it('answers 404 to an id nobody has', async () => {
    const andrei = await world.account('Andrei Marin');

    const res = await compare(randomUUID(), asDriver(andrei));

    expect(res.status).toBe(404);
  });

  it('gives an assistant reading under the driver’s grant the same body', async () => {
    const { andrei, quote, request } = await quoted();
    const service = new CompareService(prisma);

    const read = await service.get(
      driverActor(andrei, { assistantGrantId: randomUUID(), via: 'assistant' }),
      request.id,
    );

    expect(read.request.id).toBe(request.id);
    expect(read.quotes.map((q) => q.id)).toEqual([quote.id]);
  });
});

// @traces 313-FR-011
describe('GET /quote-requests/:id/quotes first seen', () => {
  const seen = (id: string) =>
    prisma.quote
      .findUniqueOrThrow({ where: { id } })
      .then((q) => q.firstSeenAt);

  it('stamps the rows on the first read and never again', async () => {
    const { andrei, quote, request } = await quoted();
    const volt = await world.garage('Volt Auto');
    const gone = await world.quote(request.id, volt.id, 'withdrawn');
    const before = new Date();

    await compare(request.id, asDriver(andrei));
    const first = await seen(quote.id);
    await compare(request.id, asDriver(andrei));

    expect(first).not.toBeNull();
    expect(first?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(await seen(quote.id)).toEqual(first);
    expect(await seen(gone.id)).toBeNull();
  });

  it('keeps one time under two reads at once', async () => {
    const { andrei, quote, request } = await quoted();

    const [one, two] = await Promise.all([
      compare(request.id, asDriver(andrei)),
      compare(request.id, asDriver(andrei)),
    ]);
    const first = await seen(quote.id);
    await compare(request.id, asDriver(andrei));

    expect([one.status, two.status]).toEqual([200, 200]);
    expect(first).not.toBeNull();
    expect(await seen(quote.id)).toEqual(first);
  });

  it('stamps the rows when the assistant reads', async () => {
    const { andrei, quote, request } = await quoted();

    await new CompareService(prisma).get(
      driverActor(andrei, { assistantGrantId: randomUUID(), via: 'assistant' }),
      request.id,
    );

    expect(await seen(quote.id)).not.toBeNull();
  });

  it('writes nothing on a refused read, and no log entry or event on any read', async () => {
    const { andrei, dinamo, quote, request } = await quoted();
    const maria = await world.account('Maria Ionescu');
    const logged = await prisma.activityLog.count();
    const events = await prisma.outboxEvent.count();

    await compare(request.id, asDriver(maria));
    await compare(request.id, bearer(dinamo.owner, 'garage'));
    expect(await seen(quote.id)).toBeNull();

    await compare(request.id, asDriver(andrei));
    expect(await prisma.activityLog.count()).toBe(logged);
    expect(await prisma.outboxEvent.count()).toBe(events);
  });
});
