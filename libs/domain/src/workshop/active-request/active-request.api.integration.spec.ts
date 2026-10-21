import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, client, get, team, world } = quotesApp();
const { prisma } = world;

const PATH = '/quote-requests/active';
const MINUTE = 60_000;

const read = async (driver: string) => {
  const res = await get(PATH, bearer(driver, 'driver'));
  expect(res.status).toBe(200);
  return res.body;
};

// A request booked at a garage, its job in the status asked, started at
// `startedAt` when it has started.
async function working(
  driver: string,
  garageId: string,
  status: 'to_do' | 'in_work' | 'paused' | 'done',
  options: { mechanicId?: string; startedAt?: Date } = {},
) {
  const chain = await world.chain(driver, garageId);
  const job = await world.job(chain.booking.id, status, {
    mechanicId: options.mechanicId,
  });
  if (status !== 'to_do') {
    await prisma.job.update({
      data: {
        startedAt: options.startedAt ?? new Date(Date.now() - 30 * MINUTE),
        ...(status === 'paused' && { pausedAt: new Date() }),
        ...(status === 'done' && { finishedAt: new Date() }),
      },
      where: { id: job.id },
    });
  }
  return { ...chain, job };
}

// @traces 274-FR-001
describe('GET /quote-requests/active for a driver with nothing open', () => {
  it('answers no request and a count of 0', async () => {
    const andrei = await world.account('Andrei Marin');

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });

  it('leaves out a closed request', async () => {
    const andrei = await world.account('Andrei Marin');
    await world.request(andrei, { status: 'closed' });

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });
});

// @traces 274-FR-001
describe('who may read it', () => {
  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
    ['plain', 'mechanic'],
  ] as const)('answers 404 to a garage %s', async (who, role) => {
    const dinamo = await team('Atelier Dinamo');

    expect((await get(PATH, bearer(dinamo[who], role))).status).toBe(404);
  });

  it('asks a visitor to sign in', async () => {
    expect((await get(PATH)).status).toBe(401);
  });

  it('never reads another driver’s request', async () => {
    const andrei = await world.account('Andrei Marin');
    const ioana = await world.account('Ioana Pop');
    await world.request(ioana);

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });
});

// @traces 274-FR-003
// @traces 274-FR-004
// @traces 274-FR-005
describe('a request waiting for quotes', () => {
  it('is sent, with its car, jobs and description and no range, garage or job', async () => {
    const andrei = await world.account('Andrei Marin');
    const sent = await world.request(andrei);

    const body = await read(andrei);

    expect(body.openCount).toBe(1);
    expect(body.request).toEqual({
      booking: null,
      car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
      description: 'Scârțâie la frânare',
      id: sent.id,
      job: null,
      jobs: [
        {
          id: expect.any(String),
          jobTypeId: expect.any(String),
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          position: 0,
        },
      ],
      mechanicName: null,
      range: null,
      stage: 'sent',
    });
  });

  it('is quoted with the range across the open quotes', async () => {
    const andrei = await world.account('Andrei Marin');
    const nordic = await world.garage('Garaj Nordic');
    const dinamo = await world.garage('Atelier Dinamo');
    const r = await world.request(andrei, { status: 'quoted' });
    const low = await world.quote(r.id, nordic.id);
    const high = await world.quote(r.id, dinamo.id);
    await prisma.quote.update({
      data: { fromBani: 12_000, toBani: 20_000 },
      where: { id: low.id },
    });
    await prisma.quote.update({
      data: { fromBani: 15_000, toBani: 26_000 },
      where: { id: high.id },
    });

    const { request } = await read(andrei);

    expect(request.stage).toBe('quoted');
    expect(request.range).toEqual({ fromBani: 12_000, toBani: 26_000 });
    expect(request.booking).toBeNull();
  });

  it('is quoted with no range once every quote has ended', async () => {
    const andrei = await world.account('Andrei Marin');
    const nordic = await world.garage('Garaj Nordic');
    const r = await world.request(andrei, { status: 'quoted' });
    await world.quote(r.id, nordic.id, 'withdrawn');

    const { request } = await read(andrei);

    expect(request.stage).toBe('quoted');
    expect(request.range).toBeNull();
  });
});

// @traces 274-FR-006
// @traces 274-FR-007
describe('a booked request', () => {
  it('awaiting the garage: booked, its garage, start and confirm-by, no mechanic', async () => {
    const andrei = await world.account('Andrei Marin');
    const nordic = await team('Garaj Nordic');
    const { booking } = await world.chain(andrei, nordic.garage.id, {
      booking: 'awaiting_confirmation',
    });
    await prisma.booking.update({
      data: { mechanicId: nordic.plainMechanic.id },
      where: { id: booking.id },
    });

    const { request } = await read(andrei);

    expect(request.stage).toBe('booked');
    expect(request.booking).toEqual({
      confirmBy: booking.confirmBy.toISOString(),
      garage: {
        id: nordic.garage.id,
        name: 'Garaj Nordic',
        slug: nordic.garage.slug,
      },
      startsAt: booking.startsAt.toISOString(),
      status: 'awaiting_confirmation',
    });
    expect(request.range).toEqual({ fromBani: 45_000, toBani: 60_000 });
    expect(request.mechanicName).toBeNull();
    expect(request.job).toBeNull();
  });

  it('confirmed: names the mechanic, even one hidden from the profile', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    const { booking } = await world.chain(andrei, dinamo.garage.id);
    await prisma.booking.update({
      data: { mechanicId: dinamo.plainMechanic.id },
      where: { id: booking.id },
    });

    const { request } = await read(andrei);

    expect(request.stage).toBe('booked');
    expect(request.booking.status).toBe('confirmed');
    expect(request.mechanicName).toBe('Hand');
  });

  it('names no mechanic when the garage works without a team', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    const { booking } = await world.chain(andrei, dinamo.garage.id);
    await prisma.booking.update({
      data: { mechanicId: dinamo.plainMechanic.id },
      where: { id: booking.id },
    });
    await prisma.garageFeature.create({
      data: {
        enabled: false,
        garageId: dinamo.garage.id,
        key: 'team_mechanics',
      },
    });

    expect((await read(andrei)).request.mechanicName).toBeNull();
  });

  it('leaves the panel after a no-show', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await world.chain(andrei, dinamo.id, {
      booking: 'no_show',
      request: 'closed',
    });

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });

  it('is back at quoted after a lapse with an open quote left', async () => {
    const andrei = await world.account('Andrei Marin');
    const nordic = await world.garage('Garaj Nordic');
    const dinamo = await world.garage('Atelier Dinamo');
    const { request: r } = await world.chain(andrei, nordic.id, {
      booking: 'lapsed',
      quote: 'expired',
      request: 'quoted',
    });
    await world.quote(r.id, dinamo.id);

    const { request } = await read(andrei);

    expect(request.stage).toBe('quoted');
    expect(request.booking).toBeNull();
    expect(request.range).toEqual({ fromBani: 45_000, toBani: 60_000 });
  });
});

// @traces 274-FR-003
// @traces 274-FR-008
// @traces 274-FR-009
describe('a request in the workshop', () => {
  it('in work: the job’s start, estimate, mechanic and steps', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    const startedAt = new Date('2026-10-09T10:07:00.000Z');
    const { booking, job } = await working(
      andrei,
      dinamo.garage.id,
      'in_work',
      {
        mechanicId: dinamo.answeringMechanic.id,
        startedAt,
      },
    );
    await prisma.booking.update({
      data: { durationMinutes: 120 },
      where: { id: booking.id },
    });
    await prisma.jobStep.createMany({
      data: [
        {
          customerLabel: 'Mașina pe elevator',
          doneAt: new Date(),
          jobId: job.id,
          label: 'Ridicare',
          position: 0,
        },
        { doneAt: new Date(), jobId: job.id, label: 'Etriere', position: 1 },
        { jobId: job.id, label: 'Plăcuțe', position: 2 },
        { jobId: job.id, label: 'Discuri', position: 3 },
        { jobId: job.id, label: 'Probă', position: 4 },
      ],
    });

    const { request } = await read(andrei);

    expect(request.stage).toBe('in_work');
    expect(request.mechanicName).toBe('Fixer');
    expect(request.job).toEqual({
      etaAt: '2026-10-09T12:10:00.000Z',
      finalPriceBani: null,
      startedAt: startedAt.toISOString(),
      status: 'in_work',
      steps: [
        { id: expect.any(String), state: 'done', text: 'Mașina pe elevator' },
        { id: expect.any(String), state: 'done', text: 'Etriere' },
        { id: expect.any(String), state: 'now', text: 'Plăcuțe' },
        { id: expect.any(String), state: 'todo', text: 'Discuri' },
        { id: expect.any(String), state: 'todo', text: 'Probă' },
      ],
    });
  });

  it('paused: still in work, no step now', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { job } = await working(andrei, dinamo.id, 'paused');
    await prisma.jobStep.create({
      data: { jobId: job.id, label: 'Plăcuțe', position: 0 },
    });

    const { request } = await read(andrei);

    expect(request.stage).toBe('in_work');
    expect(request.job.status).toBe('paused');
    expect(request.job.steps.map((s: { state: string }) => s.state)).toEqual([
      'todo',
    ]);
  });

  it('done: the final price once recorded and no estimate', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { job } = await working(andrei, dinamo.id, 'done');
    await prisma.job.update({
      data: { finalPriceBani: 98_000 },
      where: { id: job.id },
    });

    const { request } = await read(andrei);

    expect(request.stage).toBe('done');
    expect(request.job.finalPriceBani).toBe(98_000);
    expect(request.job.etaAt).toBeNull();
  });

  it('leaves the panel once the car is handed over', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { job } = await working(andrei, dinamo.id, 'done');
    await prisma.job.update({
      data: { handedOverAt: new Date() },
      where: { id: job.id },
    });

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });
});

// @traces 274-FR-002
// @traces 274-FR-016
describe('several open requests', () => {
  it('answers the one in work first and counts them all', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const nordic = await world.garage('Garaj Nordic');
    await world.request(andrei);
    await world.chain(andrei, nordic.id);
    const { request: inWork } = await working(andrei, dinamo.id, 'in_work');
    await working(andrei, dinamo.id, 'done');

    const body = await read(andrei);

    expect(body.openCount).toBe(4);
    expect(body.request.id).toBe(inWork.id);
  });

  it('answers the booked one before one waiting for quotes', async () => {
    const andrei = await world.account('Andrei Marin');
    const nordic = await world.garage('Garaj Nordic');
    const { request: booked } = await world.chain(andrei, nordic.id);
    await world.request(andrei);

    expect((await read(andrei)).request.id).toBe(booked.id);
  });
});

// @traces 274-FR-001
describe('the cost of the read', () => {
  it('runs the same statements for 1 and for 10 open requests', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'in_work');
    const requests = jest.spyOn(client().quoteRequest, 'findMany');
    const features = jest.spyOn(client().garageFeature, 'findUnique');

    await read(andrei);
    const one = [requests.mock.calls.length, features.mock.calls.length];
    for (let i = 0; i < 9; i++) await working(andrei, dinamo.id, 'in_work');
    requests.mockClear();
    features.mockClear();
    await read(andrei);

    expect([requests.mock.calls.length, features.mock.calls.length]).toEqual(
      one,
    );
    expect(one).toEqual([1, 1]);
    requests.mockRestore();
    features.mockRestore();
  });
});
