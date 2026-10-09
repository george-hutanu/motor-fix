import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { AuditService } from '../../audit/audit.service';
import { atLocal, localDay } from '../../bucharest';
import { outboxMark } from '../../events/outbox.testing';
import { quotesApp } from '../quotes-api.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

let mark: bigint;
beforeEach(async () => {
  mark = await outboxMark(prisma);
});
afterEach(() => jest.restoreAllMocks());

const NO_FUEL = {
  diesel: false,
  electric: false,
  hybrid: false,
  petrol: false,
};

type Fuels = Partial<
  Record<'petrol' | 'diesel' | 'hybrid' | 'electric', boolean>
>;

// A garage that works on the brand, with the jobs it ticked for it.
async function taker(
  name: string,
  brandId: string,
  jobTypeIds: string[] = [],
  row: { stance?: 'works_on' | 'does_not_take' } & Fuels = {},
) {
  const garage = await world.garage(name);
  // A brand the garage does not take has no fuel ticked.
  const refused = row.stance === 'does_not_take' && NO_FUEL;
  await prisma.garageBrand.create({
    data: {
      brandId,
      garageId: garage.id,
      stance: 'works_on',
      ...row,
      ...refused,
    },
  });
  if (jobTypeIds.length > 0) {
    await prisma.garageBrandJob.createMany({
      data: jobTypeIds.map((jobTypeId) => ({
        brandId,
        garageId: garage.id,
        jobTypeId,
      })),
    });
  }
  return garage;
}

// A driver with a car, two job types and a garage that takes both.
async function scene() {
  const driver = await world.account('Andrei Marin');
  const car = await world.car(driver);
  const oil = await world.jobType();
  const brakes = await world.jobType('Plăcuțe frână', 'Brake pads');
  const garage = await taker('Service Auto Militari', car.brandId, [
    oil.id,
    brakes.id,
  ]);
  const auth = bearer(driver, 'driver');
  const body = {
    carId: car.id,
    description: 'Scârțâie la frânare pe față',
    garageIds: [garage.id],
    jobTypeIds: [oil.id, brakes.id],
    sources: ['profile_direct'],
  };
  return { auth, body, brakes, car, driver, garage, oil };
}

// A fresh key unless one is given; null sends none.
const send = (
  body: unknown,
  auth?: string,
  key: string | null = randomUUID(),
) => post('/quote-requests', body, auth, key ?? undefined);

const rows = async () => ({
  jobs: await prisma.requestJob.count(),
  recipients: await prisma.requestRecipient.count(),
  requests: await prisma.quoteRequest.count(),
});
const none = { jobs: 0, recipients: 0, requests: 0 };

const created = () =>
  prisma.outboxEvent.findMany({
    where: { id: { gt: mark }, kind: 'request.created' },
  });
// The history outlives the per-case reset, so it is read by the case's driver.
const audit = (actorId: string) =>
  prisma.activityLog.findMany({
    where: { actorId, subjectType: 'quote_request' },
  });

async function sentCounts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === 'motorfix_quote_requests_sent_total');
  return (found?.dataPoints ?? []).map((point) => ({
    attributes: point.attributes,
    value: point.value,
  }));
}

// @traces 221-FR-001
// @traces 221-FR-005
// @traces 221-FR-010
// @traces 221-FR-013
// @traces 221-FR-016
describe('POST /quote-requests', () => {
  it('stores the request with its car, jobs and garage, and answers it as the driver reads it', async () => {
    const { auth, body, brakes, car, driver, garage, oil } = await scene();

    const res = await send(body, auth);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      booking: null,
      car: {
        engine: '2.0 turbo',
        fuel: 'petrol',
        model: 'Cooper S',
        year: 2019,
      },
      closedAt: null,
      description: 'Scârțâie la frânare pe față',
      jobs: [
        { jobTypeId: oil.id, nameRo: 'Schimb ulei', position: 1 },
        { jobTypeId: brakes.id, nameEn: 'Brake pads', position: 2 },
      ],
      quotes: [],
      quotesCount: 0,
      recipients: [
        {
          answeredAt: null,
          garage: { id: garage.id, name: garage.name, slug: garage.slug },
          status: 'waiting',
        },
      ],
      status: 'sent',
    });
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: car.brandId },
    });
    expect(res.body.car.brand).toBe(brand.name);
    const stored = await prisma.quoteRequest.findUniqueOrThrow({
      include: { recipients: true },
      where: { id: res.body.id },
    });
    expect(stored).toMatchObject({ carId: car.id, driverId: driver });
    expect(stored.recipients[0].source).toBe('profile_direct');
    const days =
      (stored.expiresAt.getTime() - stored.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it('stores each garage’s source as the dialog gave it', async () => {
    const { auth, body, car, oil } = await scene();
    const other = await taker('Atelier Berceni', car.brandId, [oil.id]);

    const res = await send(
      {
        ...body,
        garageIds: [...body.garageIds, other.id],
        sources: ['shared_link', 'search'],
      },
      auth,
    );

    expect(res.status).toBe(201);
    const recipients = await prisma.requestRecipient.findMany({
      where: { requestId: res.body.id },
    });
    expect(
      Object.fromEntries(recipients.map((r) => [r.garageId, r.source])),
    ).toEqual({ [body.garageIds[0]]: 'shared_link', [other.id]: 'search' });
  });

  it('sends a description alone when no job is switched on', async () => {
    const { auth, body } = await scene();

    const res = await send(
      { ...body, description: 'Bate ceva în față', jobTypeIds: [] },
      auth,
    );

    expect(res.status).toBe(201);
    expect(res.body.jobs).toEqual([]);
  });

  it('lets a driver whose e-mail is not confirmed send', async () => {
    const { auth, body, driver } = await scene();
    await prisma.account.update({
      data: { emailVerifiedAt: null },
      where: { id: driver },
    });

    expect((await send(body, auth)).status).toBe(201);
  });

  it('writes one audit entry without the description and one event of ids only', async () => {
    const { auth, body, car, driver, garage, oil, brakes } = await scene();

    const res = await send(body, auth);

    const entries = await audit(driver);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: driver,
      actorRole: 'driver',
      carId: car.id,
      subjectId: res.body.id,
      subjectType: 'quote_request',
    });
    expect(entries[0].newValue).toEqual({
      garageIds: [garage.id],
      jobTypeIds: [oil.id, brakes.id],
    });
    expect(JSON.stringify(entries[0])).not.toContain('Scârțâie');
    expect(JSON.stringify(entries[0])).not.toContain('B123ABC');
    const events = await created();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: {
        driverId: driver,
        garageIds: [garage.id],
        requestId: res.body.id,
      },
      subjectId: res.body.id,
    });
    expect(events[0].audience).toEqual([
      `account:${driver}`,
      `garage:${garage.id}`,
    ]);
  });

  it('never answers with the plate or a phone', async () => {
    const { auth, body } = await scene();

    const res = await send(body, auth);

    expect(JSON.stringify(res.body)).not.toContain('B123ABC');
    expect(JSON.stringify(res.body)).not.toMatch(/phone/i);
  });

  it('leaves no request, audit entry or event when the audit cannot be written', async () => {
    const { auth, body, driver } = await scene();
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValue(new Error('history unavailable'));

    const res = await send(body, auth);

    expect(res.status).toBe(500);
    expect(await rows()).toEqual(none);
    expect(await audit(driver)).toHaveLength(0);
    expect(await created()).toHaveLength(0);
  });

  it('counts each sent request with its recipients', async () => {
    const { auth, body } = await scene();
    const before = await sentCounts();

    await send(body, auth);

    const after = await sentCounts();
    const sent = (list: typeof after) =>
      list.find(
        (p) =>
          p.attributes['outcome'] === 'sent' &&
          p.attributes['recipients'] === 1,
      )?.value ?? 0;
    expect(Number(sent(after)) - Number(sent(before))).toBe(1);
  });
});

// @traces 221-FR-008
describe('the idempotency key', () => {
  it('answers a second call with the same key as the first and writes nothing', async () => {
    const { auth, body } = await scene();
    const key = randomUUID();

    const first = await send(body, auth, key);
    const between = await sentCounts();
    const second = await send(
      { ...body, description: 'Alt text complet' },
      auth,
      key,
    );

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await rows()).toEqual({ jobs: 2, recipients: 1, requests: 1 });
    expect(await created()).toHaveLength(1);
    // The replay is not counted as a second send.
    expect(await sentCounts()).toEqual(between);
  });

  it('creates a second request under a different key', async () => {
    const { auth, body } = await scene();

    await send(body, auth);
    await send(body, auth);

    expect((await rows()).requests).toBe(2);
  });

  it('judges a key afresh after a refused call', async () => {
    const { auth, body } = await scene();
    const key = randomUUID();

    expect(
      (await send({ ...body, carId: randomUUID() }, auth, key)).status,
    ).toBe(404);
    expect((await send(body, auth, key)).status).toBe(201);
  });

  it('refuses a call without a key and a key over 64 characters', async () => {
    const { auth, body } = await scene();

    for (const key of [null, 'k'.repeat(65)]) {
      const res = await send(body, auth, key);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'required', field: 'idempotency-key' }],
      });
    }
    expect(await rows()).toEqual(none);
  });

  it('takes a key of 64 characters', async () => {
    const { auth, body } = await scene();

    expect((await send(body, auth, 'k'.repeat(64))).status).toBe(201);
  });
});

// @traces 221-FR-009
describe('the daily limit', () => {
  async function sentToday(driver: string, carId: string, n: number) {
    const start = atLocal(localDay(new Date()), 0);
    for (let i = 0; i < n; i++) {
      await world.request(driver, {
        carId,
        createdAt: new Date(start.getTime() + i * 1000),
      });
    }
  }

  it('takes the 20th request of a Bucharest day', async () => {
    const { auth, body, car, driver } = await scene();
    await sentToday(driver, car.id, 19);

    expect((await send(body, auth)).status).toBe(201);
  });

  it('refuses the 21st with 429 and writes nothing', async () => {
    const { auth, body, car, driver } = await scene();
    await sentToday(driver, car.id, 20);
    const before = await rows();

    const res = await send(body, auth);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_requests');
    expect(await rows()).toEqual(before);
  });

  it('does not count yesterday’s requests', async () => {
    const { auth, body, car, driver } = await scene();
    const yesterday = new Date(
      atLocal(localDay(new Date()), 0).getTime() - 60_000,
    );
    for (let i = 0; i < 20; i++) {
      await world.request(driver, { carId: car.id, createdAt: yesterday });
    }

    expect((await send(body, auth)).status).toBe(201);
  });
});

// @traces 221-FR-005
// @traces 221-FR-019
describe('what a request must hold', () => {
  const refused = async (res: { status: number; body: { code?: string } }) => {
    expect(res.status).toBe(400);
    expect(await rows()).toEqual(none);
  };

  it('refuses no garage, six garages and a repeated garage', async () => {
    const { auth, body } = await scene();
    const six = Array.from({ length: 6 }, () => randomUUID());

    await refused(await send({ ...body, garageIds: [], sources: [] }, auth));
    const many = await send(
      { ...body, garageIds: six, sources: six.map(() => 'search') },
      auth,
    );
    await refused(many);
    expect(many.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'too_many', field: 'garageIds' }],
    });
    await refused(
      await send(
        {
          ...body,
          garageIds: [body.garageIds[0], body.garageIds[0]],
          sources: ['search', 'search'],
        },
        auth,
      ),
    );
  });

  it('refuses sources that do not match the garages one for one', async () => {
    const { auth, body } = await scene();

    const res = await send(
      { ...body, sources: ['profile_direct', 'search'] },
      auth,
    );

    await refused(res);
    expect(res.body.errors).toEqual([
      { code: 'length_mismatch', field: 'sources' },
    ]);
  });

  it('asks a request without jobs for a description of at least 10 characters', async () => {
    const { auth, body } = await scene();

    const missing = await send(
      { ...body, description: undefined, jobTypeIds: [] },
      auth,
    );
    await refused(missing);
    expect(missing.body.errors).toEqual([
      { code: 'required', field: 'description' },
    ]);
    const short = await send(
      { ...body, description: 'Bate ceva', jobTypeIds: [] },
      auth,
    );
    await refused(short);
    expect(short.body.errors).toEqual([
      { code: 'too_short', field: 'description' },
    ]);
    expect(
      (await send({ ...body, description: 'Bate ceva!', jobTypeIds: [] }, auth))
        .status,
    ).toBe(201);
  });

  it('refuses a description of 1,001 characters', async () => {
    const { auth, body } = await scene();

    await refused(await send({ ...body, description: 'a'.repeat(1001) }, auth));
  });
});

// @traces 221-FR-001
describe('who may send, for which car', () => {
  it('answers 401 sign_in_required without a session', async () => {
    const { body } = await scene();

    const res = await send(body);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 404 for another driver’s car and a removed car', async () => {
    const { auth, body } = await scene();
    const maria = await world.account('Maria Ionescu');
    const hers = await world.car(maria);
    const mine = await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: body.carId },
    });

    expect((await send({ ...body, carId: hers.id }, auth)).status).toBe(404);
    expect((await send({ ...body, carId: mine.id }, auth)).status).toBe(404);
    expect(await rows()).toEqual(none);
  });

  it('answers 404 to a garage-role session', async () => {
    const { body } = await scene();
    const { owner } = await team('Atelier Dinamo');

    expect((await send(body, bearer(owner, 'garage'))).status).toBe(404);
  });

  it('shows the sent request in the driver’s list', async () => {
    const { auth, body } = await scene();
    const res = await send(body, auth);

    const list = await get('/requests', auth);

    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([
      res.body.id,
    ]);
  });
});

// @traces 221-FR-007
// @traces 221-FR-019
describe('routing', () => {
  async function refusedFor(
    garage: { id: string; name: string },
    reason: string,
    res: { status: number; body: Record<string, unknown> },
  ) {
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'garage_cannot_receive',
      garageId: garage.id,
      garageName: garage.name,
      reason,
    });
    expect(await rows()).toEqual(none);
  }

  it('refuses a garage that does not take the brand', async () => {
    const { auth, body, car, oil } = await scene();
    const garage = await taker('Atelier Dinamo', car.brandId, [oil.id], {
      stance: 'does_not_take',
    });

    await refusedFor(
      garage,
      'brand',
      await send(
        { ...body, garageIds: [garage.id], jobTypeIds: [oil.id] },
        auth,
      ),
    );
  });

  it('refuses a garage with no row for the brand', async () => {
    const { auth, body } = await scene();
    const garage = await world.garage('Auto Pipera');

    await refusedFor(
      garage,
      'brand',
      await send({ ...body, garageIds: [garage.id] }, auth),
    );
  });

  it('refuses a garage that has not ticked the car’s fuel', async () => {
    const { auth, body, car, oil } = await scene();
    const garage = await taker('Diesel Expert', car.brandId, [oil.id], {
      petrol: false,
    });

    await refusedFor(
      garage,
      'fuel',
      await send(
        { ...body, garageIds: [garage.id], jobTypeIds: [oil.id] },
        auth,
      ),
    );
  });

  it('takes a garage that ticked some of the jobs', async () => {
    const { auth, body, car, oil } = await scene();
    const garage = await taker('Ulei Rapid', car.brandId, [oil.id]);

    expect((await send({ ...body, garageIds: [garage.id] }, auth)).status).toBe(
      201,
    );
  });

  it('refuses a garage that ticked none of the jobs', async () => {
    const { auth, body, car } = await scene();
    const garage = await taker('Doar Roți', car.brandId);

    await refusedFor(
      garage,
      'jobs',
      await send({ ...body, garageIds: [garage.id] }, auth),
    );
  });

  it('routes a request with no job on brand and fuel alone', async () => {
    const { auth, body, car } = await scene();
    const garage = await taker('Doar Roți', car.brandId);

    expect(
      (await send({ ...body, garageIds: [garage.id], jobTypeIds: [] }, auth))
        .status,
    ).toBe(201);
  });

  it('refuses a suspended garage and a draft one as not taking requests', async () => {
    const { auth, body, car, oil } = await scene();
    for (const status of ['suspended', 'draft'] as const) {
      const garage = await taker(`Închis ${status}`, car.brandId, [oil.id]);
      await prisma.garage.update({
        data: { status },
        where: { id: garage.id },
      });

      await refusedFor(
        garage,
        'not_taking_requests',
        await send(
          { ...body, garageIds: [garage.id], jobTypeIds: [oil.id] },
          auth,
        ),
      );
    }
  });

  it('names an id no garage holds as not taking requests', async () => {
    const { auth, body } = await scene();
    const id = randomUUID();

    const res = await send({ ...body, garageIds: [id] }, auth);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'garage_cannot_receive',
      garageId: id,
      reason: 'not_taking_requests',
    });
  });

  it('answers the first failing garage in the order sent and writes nothing for the others', async () => {
    const { auth, body, car, garage, oil } = await scene();
    const fuel = await taker('Diesel Expert', car.brandId, [oil.id], {
      petrol: false,
    });
    const brand = await taker('Atelier Dinamo', car.brandId, [oil.id], {
      stance: 'does_not_take',
    });

    await refusedFor(
      fuel,
      'fuel',
      await send(
        {
          ...body,
          garageIds: [garage.id, fuel.id, brand.id],
          jobTypeIds: [oil.id],
          sources: ['profile_direct', 'search', 'search'],
        },
        auth,
      ),
    );
  });
});
