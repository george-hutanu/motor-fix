import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PATH = '/quote-requests/active';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JOB_STATUSES = ['to_do', 'in_work', 'paused', 'done'];

const read = async (driver: string, path = PATH) => {
  const res = await get(path, bearer(driver, 'driver'));
  expect(res.status).toBe(200);
  return res.body;
};

async function working(
  driver: string,
  garageId: string,
  status: 'to_do' | 'in_work' | 'paused' | 'done' | 'cancelled',
  options: {
    mechanicId?: string;
    startedAt?: Date;
    etaAt?: Date;
    durationMinutes?: number;
  } = {},
) {
  const chain = await world.chain(driver, garageId);
  const job = await world.job(chain.booking.id, status, {
    mechanicId: options.mechanicId,
  });
  const started = !['to_do', 'cancelled'].includes(status);
  await prisma.job.update({
    data: {
      ...(started && {
        startedAt: options.startedAt ?? new Date(Date.now() - 30 * MINUTE),
      }),
      ...(status === 'paused' && { pausedAt: new Date() }),
      ...(status === 'done' && { finishedAt: new Date() }),
      ...(options.etaAt && { etaAt: options.etaAt }),
    },
    where: { id: job.id },
  });
  if (options.durationMinutes !== undefined) {
    await prisma.booking.update({
      data: { durationMinutes: options.durationMinutes },
      where: { id: chain.booking.id },
    });
  }
  return { ...chain, job };
}

// Moves every timestamp a request carries to `at`, so a case can make one
// of them the latest by hand.
async function age(requestId: string, at: Date) {
  await prisma.quoteRequest.update({
    data: { createdAt: at },
    where: { id: requestId },
  });
  await prisma.quote.updateMany({ data: { sentAt: at }, where: { requestId } });
  const bookings = await prisma.booking.findMany({ where: { requestId } });
  for (const b of bookings) {
    await prisma.booking.update({
      data: { createdAt: at, ...(b.confirmedAt && { confirmedAt: at }) },
      where: { id: b.id },
    });
    const job = await prisma.job.findUnique({ where: { bookingId: b.id } });
    if (job) {
      await prisma.job.update({
        data: {
          ...(job.startedAt && { startedAt: at }),
          ...(job.pausedAt && { pausedAt: at }),
          ...(job.finishedAt && { finishedAt: at }),
        },
        where: { id: job.id },
      });
    }
  }
}

// @traces 274-FR-001
describe('which requests count as open', () => {
  it('leaves out a booked request whose only booking lapsed', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await world.chain(andrei, dinamo.id, { booking: 'lapsed' });

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });

  it('leaves out a request in work whose booking was cancelled', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await world.chain(andrei, dinamo.id, {
      booking: 'cancelled',
      request: 'in_work',
    });

    expect(await read(andrei)).toEqual({ openCount: 0, request: null });
  });

  it('keeps a done request whose car is not handed over, its booking completed', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { booking } = await working(andrei, dinamo.id, 'done');
    await prisma.booking.update({
      data: { completedAt: new Date(), status: 'completed' },
      where: { id: booking.id },
    });
    await prisma.quoteRequest.update({
      data: { status: 'done' },
      where: { id: booking.requestId },
    });

    const body = await read(andrei);

    expect(body.openCount).toBe(1);
    expect(body.request.stage).toBe('done');
    expect(body.request.booking.status).toBe('completed');
  });

  it('counts none of another driver’s open requests, whatever their stage', async () => {
    const andrei = await world.account('Andrei Marin');
    const ioana = await world.account('Ioana Pop');
    const dinamo = await world.garage('Atelier Dinamo');
    const mine = await world.request(andrei);
    await working(ioana, dinamo.id, 'in_work');
    await world.chain(ioana, dinamo.id, { booking: 'awaiting_confirmation' });

    const body = await read(andrei);

    expect(body.openCount).toBe(1);
    expect(body.request.id).toBe(mine.id);
  });

  it('ignores a driver id put in the query', async () => {
    const andrei = await world.account('Andrei Marin');
    const ioana = await world.account('Ioana Pop');
    await world.request(ioana);

    expect(
      await read(andrei, `${PATH}?driverId=${ioana}&driver=${ioana}`),
    ).toEqual({ openCount: 0, request: null });
  });

  it('asks a caller with a forged token to sign in', async () => {
    const res = await get(PATH, 'Bearer not.a.token');

    expect(res.status).toBe(401);
  });

  it('answers the same twice and writes nothing', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { job, request } = await working(andrei, dinamo.id, 'in_work', {
      durationMinutes: 120,
    });
    const before = await Promise.all([
      prisma.quoteRequest.findUniqueOrThrow({ where: { id: request.id } }),
      prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
    ]);

    const first = await read(andrei);
    const second = await read(andrei);

    expect(second).toEqual(first);
    expect(
      await Promise.all([
        prisma.quoteRequest.findUniqueOrThrow({ where: { id: request.id } }),
        prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
      ]),
    ).toEqual(before);
  });
});

// @traces 274-FR-002
describe('which open request comes first', () => {
  it('puts a request waiting for quotes before a done car', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'done');
    const waiting = await world.request(andrei, {
      createdAt: new Date(Date.now() - 10 * DAY),
    });

    const body = await read(andrei);

    expect(body.openCount).toBe(2);
    expect(body.request.id).toBe(waiting.id);
  });

  it('puts a paused job before a booked request', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { request: paused } = await working(andrei, dinamo.id, 'paused');
    await age(paused.id, new Date(Date.now() - 5 * DAY));
    await world.chain(andrei, dinamo.id);

    expect((await read(andrei)).request.id).toBe(paused.id);
  });

  it('breaks a tie between two jobs in work by the latest pause', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { job: older, request: first } = await working(
      andrei,
      dinamo.id,
      'in_work',
    );
    const { request: second } = await working(andrei, dinamo.id, 'in_work');
    await age(first.id, new Date(Date.now() - 3 * DAY));
    await age(second.id, new Date(Date.now() - 2 * DAY));
    await prisma.job.update({
      data: { pausedAt: new Date(Date.now() - MINUTE), status: 'paused' },
      where: { id: older.id },
    });

    expect((await read(andrei)).request.id).toBe(first.id);
  });

  it('breaks a tie between two booked requests by the latest confirmation', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { booking, request: first } = await world.chain(andrei, dinamo.id);
    const { request: second } = await world.chain(andrei, dinamo.id);
    await age(first.id, new Date(Date.now() - 3 * DAY));
    await age(second.id, new Date(Date.now() - 2 * DAY));
    await prisma.booking.update({
      data: { confirmedAt: new Date(Date.now() - MINUTE) },
      where: { id: booking.id },
    });

    expect((await read(andrei)).request.id).toBe(first.id);
  });

  it('breaks a tie between two waiting requests by the latest quote sent', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const older = await world.request(andrei, {
      createdAt: new Date(Date.now() - 3 * DAY),
      status: 'quoted',
    });
    await world.request(andrei, {
      createdAt: new Date(Date.now() - 2 * DAY),
      status: 'quoted',
    });
    const quote = await world.quote(older.id, dinamo.id);
    await prisma.quote.update({
      data: { sentAt: new Date(Date.now() - MINUTE) },
      where: { id: quote.id },
    });

    expect((await read(andrei)).request.id).toBe(older.id);
  });

  it('breaks a tie between sent requests by the newest creation', async () => {
    const andrei = await world.account('Andrei Marin');
    await world.request(andrei, { createdAt: new Date(Date.now() - 2 * DAY) });
    const newest = await world.request(andrei, {
      createdAt: new Date(Date.now() - HOUR),
    });
    await world.request(andrei, { createdAt: new Date(Date.now() - DAY) });

    const body = await read(andrei);

    expect(body.openCount).toBe(3);
    expect(body.request.id).toBe(newest.id);
  });
});

// @traces 274-FR-003
describe('the stage when the rows disagree', () => {
  it('is booked for a quoted request that has a booking awaiting the garage', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await world.chain(andrei, dinamo.id, {
      booking: 'awaiting_confirmation',
      request: 'quoted',
    });

    expect((await read(andrei)).request.stage).toBe('booked');
  });

  it('is done when the job is done though the request still says booked', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'done');

    expect((await read(andrei)).request.stage).toBe('done');
  });

  it('follows the newest live booking, not an older one', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const nordic = await world.garage('Garaj Nordic');
    const { booking: old, request } = await world.chain(andrei, dinamo.id, {
      quote: 'expired',
    });
    await prisma.booking.update({
      data: { createdAt: new Date(Date.now() - DAY) },
      where: { id: old.id },
    });
    const q = await world.quote(request.id, nordic.id, 'accepted');
    await world.booking(q.id, 'awaiting_confirmation');

    const { request: active } = await read(andrei);

    expect(active.booking.garage.name).toBe('Garaj Nordic');
    expect(active.booking.status).toBe('awaiting_confirmation');
  });

  it('skips a newer lapsed booking for the older confirmed one', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const nordic = await world.garage('Garaj Nordic');
    const { booking: old, request } = await world.chain(andrei, dinamo.id);
    await prisma.booking.update({
      data: { createdAt: new Date(Date.now() - DAY) },
      where: { id: old.id },
    });
    const q = await world.quote(request.id, nordic.id, 'expired');
    await world.booking(q.id, 'lapsed');

    const { request: active } = await read(andrei);

    expect(active.stage).toBe('booked');
    expect(active.booking.garage.name).toBe('Atelier Dinamo');
    expect(active.booking.status).toBe('confirmed');
  });

  it('is booked with no start or finish while the job is to do', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'to_do');

    const { request } = await read(andrei);

    expect(request.stage).toBe('booked');
    expect(request.job?.startedAt ?? null).toBeNull();
    expect(request.job?.etaAt ?? null).toBeNull();
  });

  it('answers only job statuses the contract knows when the job was cancelled', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'cancelled');

    const { request } = await read(andrei);

    expect(request.stage).toBe('booked');
    expect(
      request.job === null || JOB_STATUSES.includes(request.job.status),
    ).toBe(true);
  });
});

// @traces 274-FR-005
describe('the range from awkward quotes', () => {
  it('leaves out ended quotes with a wider range', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const nordic = await world.garage('Garaj Nordic');
    const tiriac = await world.garage('Service Țiriac');
    const r = await world.request(andrei, { status: 'quoted' });
    await world.quote(r.id, dinamo.id);
    const gone = await world.quote(r.id, nordic.id, 'withdrawn');
    const old = await world.quote(r.id, tiriac.id, 'expired');
    await prisma.quote.updateMany({
      data: { fromBani: 100, toBani: 9_000_000 },
      where: { id: { in: [gone.id, old.id] } },
    });

    expect((await read(andrei)).request.range).toEqual({
      fromBani: 45_000,
      toBani: 60_000,
    });
  });

  it('is the accepted quote’s alone once booked, with another still open', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const nordic = await world.garage('Garaj Nordic');
    const { request } = await world.chain(andrei, dinamo.id);
    const other = await world.quote(request.id, nordic.id);
    await prisma.quote.update({
      data: { fromBani: 1_000, toBani: 900_000 },
      where: { id: other.id },
    });

    expect((await read(andrei)).request.range).toEqual({
      fromBani: 45_000,
      toBani: 60_000,
    });
  });
});

// @traces 274-FR-007
describe('the mechanic named', () => {
  it('is the job’s mechanic before the booking’s', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    const { booking } = await working(andrei, dinamo.garage.id, 'in_work', {
      mechanicId: dinamo.answeringMechanic.id,
    });
    await prisma.booking.update({
      data: { mechanicId: dinamo.plainMechanic.id },
      where: { id: booking.id },
    });

    expect((await read(andrei)).request.mechanicName).toBe('Fixer');
  });

  it('is named when the team switch is on', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    await working(andrei, dinamo.garage.id, 'in_work', {
      mechanicId: dinamo.plainMechanic.id,
    });
    await prisma.garageFeature.create({
      data: {
        enabled: true,
        garageId: dinamo.garage.id,
        key: 'team_mechanics',
      },
    });

    expect((await read(andrei)).request.mechanicName).toBe('Hand');
  });

  it('is named when another garage has turned its team switch off', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    const nordic = await world.garage('Garaj Nordic');
    await working(andrei, dinamo.garage.id, 'in_work', {
      mechanicId: dinamo.plainMechanic.id,
    });
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: nordic.id, key: 'team_mechanics' },
    });

    expect((await read(andrei)).request.mechanicName).toBe('Hand');
  });

  it('is nobody for the job’s mechanic when the team switch is off', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    await working(andrei, dinamo.garage.id, 'in_work', {
      mechanicId: dinamo.answeringMechanic.id,
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
});

// @traces 274-FR-008
describe('the estimate rounded to five minutes', () => {
  const at = (iso: string) => new Date(iso);

  it.each([
    [
      'an exact mark stays',
      '2026-10-09T12:10:00.000Z',
      '2026-10-09T12:10:00.000Z',
    ],
    [
      'a second past rounds up',
      '2026-10-09T12:10:01.000Z',
      '2026-10-09T12:15:00.000Z',
    ],
    [
      'a minute short rounds up',
      '2026-10-09T12:14:00.000Z',
      '2026-10-09T12:15:00.000Z',
    ],
    ['across the hour', '2026-10-09T12:56:00.000Z', '2026-10-09T13:00:00.000Z'],
    ['across midnight', '2026-10-09T23:58:00.000Z', '2026-10-10T00:00:00.000Z'],
  ])('from the garage’s estimate: %s', async (_, eta, expected) => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'in_work', {
      etaAt: at(eta),
      startedAt: at('2026-10-09T10:00:00.000Z'),
    });

    expect((await read(andrei)).request.job.etaAt).toBe(expected);
  });

  it.each([
    [
      'an exact mark stays',
      '2026-10-09T10:05:00.000Z',
      60,
      '2026-10-09T11:05:00.000Z',
    ],
    [
      'seconds past round up',
      '2026-10-09T10:05:30.000Z',
      60,
      '2026-10-09T11:10:00.000Z',
    ],
    [
      'a long job',
      '2026-10-09T10:07:00.000Z',
      3 * 24 * 60,
      '2026-10-12T10:10:00.000Z',
    ],
  ])(
    'from the start and the duration: %s',
    async (_, start, minutes, expected) => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await working(andrei, dinamo.id, 'in_work', {
        durationMinutes: minutes,
        startedAt: at(start),
      });

      expect((await read(andrei)).request.job.etaAt).toBe(expected);
    },
  );

  it('keeps the estimate while paused', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'paused', {
      durationMinutes: 120,
      startedAt: at('2026-10-09T10:07:00.000Z'),
    });

    expect((await read(andrei)).request.job.etaAt).toBe(
      '2026-10-09T12:10:00.000Z',
    );
  });

  it('keeps an estimate that has passed', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'in_work', {
      etaAt: at('2020-01-01T08:03:00.000Z'),
      startedAt: at('2020-01-01T07:00:00.000Z'),
    });

    expect((await read(andrei)).request.job.etaAt).toBe(
      '2020-01-01T08:05:00.000Z',
    );
  });

  it('drops the garage’s estimate once the job is done', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await working(andrei, dinamo.id, 'done', {
      etaAt: at('2026-10-09T12:10:00.000Z'),
    });

    expect((await read(andrei)).request.job.etaAt).toBeNull();
  });
});

// @traces 274-FR-009
describe('the steps from awkward rows', () => {
  const steps = async (
    status: 'to_do' | 'in_work' | 'paused' | 'done',
    rows: {
      position: number;
      label: string;
      done?: boolean;
      customer?: string;
    }[],
  ) => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    const { job } = await working(andrei, dinamo.id, status);
    for (const r of rows) {
      await prisma.jobStep.create({
        data: {
          customerLabel: r.customer ?? null,
          doneAt: r.done ? new Date() : null,
          jobId: job.id,
          label: r.label,
          position: r.position,
        },
      });
    }
    const { request } = await read(andrei);
    return (request.job?.steps ?? []).map(
      (s: { text: string; state: string }) => [s.text, s.state],
    );
  };

  it('come in position order whatever order they were written in', async () => {
    expect(
      await steps('in_work', [
        { label: 'C', position: 2 },
        { label: 'A', position: 0 },
        { label: 'B', position: 1 },
      ]),
    ).toEqual([
      ['A', 'now'],
      ['B', 'todo'],
      ['C', 'todo'],
    ]);
  });

  it('mark the first unticked step now even when a later one is ticked', async () => {
    expect(
      await steps('in_work', [
        { label: 'A', position: 0 },
        { done: true, label: 'B', position: 1 },
        { label: 'C', position: 2 },
      ]),
    ).toEqual([
      ['A', 'now'],
      ['B', 'done'],
      ['C', 'todo'],
    ]);
  });

  it('mark none now when every step is ticked', async () => {
    expect(
      await steps('in_work', [
        { done: true, label: 'A', position: 0 },
        { done: true, label: 'B', position: 1 },
      ]),
    ).toEqual([
      ['A', 'done'],
      ['B', 'done'],
    ]);
  });

  it('mark none now on a done job with a step left unticked', async () => {
    expect(
      await steps('done', [
        { done: true, label: 'A', position: 0 },
        { label: 'B', position: 1 },
      ]),
    ).toEqual([
      ['A', 'done'],
      ['B', 'todo'],
    ]);
  });

  it('keep the garage’s customer wording as written, unicode and all', async () => {
    expect(
      await steps('in_work', [
        { customer: 'Verificăm frânele 🔧 <ok>', label: 'Frâne', position: 0 },
      ]),
    ).toEqual([['Verificăm frânele 🔧 <ok>', 'now']]);
  });
});
