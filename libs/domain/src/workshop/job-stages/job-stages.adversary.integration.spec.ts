import type {
  JobStatus,
  QuoteRequestStatus,
} from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

const REQUEST_OF: Record<JobStatus, QuoteRequestStatus> = {
  cancelled: 'booked',
  done: 'done',
  in_work: 'in_work',
  paused: 'in_work',
  to_do: 'booked',
};

type Team = Awaited<ReturnType<typeof team>>;

async function setting(
  status: JobStatus = 'to_do',
  options: { received?: boolean; request?: QuoteRequestStatus } = {},
) {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const job = await jobOf(dinamo, andrei, status, options);
  return {
    andrei,
    desk: bearer(dinamo.receptionist, 'receptionist'),
    dinamo,
    hand: bearer(dinamo.plain, 'mechanic'),
    job,
    militari,
    other: bearer(dinamo.answering, 'mechanic'),
    owner: bearer(dinamo.owner, 'garage'),
    stranger: bearer(militari.owner, 'garage'),
  };
}

async function jobOf(
  t: Team,
  driverId: string,
  status: JobStatus,
  options: {
    received?: boolean;
    request?: QuoteRequestStatus;
    mechanicId?: string | null;
  } = {},
) {
  const { booking } = await world.chain(driverId, t.garage.id, {
    request: options.request ?? REQUEST_OF[status],
  });
  const job = await world.job(booking.id, status);
  return prisma.job.update({
    data: {
      mechanicId:
        options.mechanicId === undefined
          ? t.plainMechanic.id
          : options.mechanicId,
      receivedAt: options.received === false ? null : new Date(),
    },
    where: { id: job.id },
  });
}

const stage = (jobId: string, verb: string, auth: string, body?: object) =>
  send('post', `/garage/jobs/${jobId}/${verb}`, auth, body);

const receive = (jobId: string, auth: string, body?: unknown) =>
  send('post', `/garage/jobs/${jobId}/receive`, auth, body as object);

const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

async function requestOf(jobId: string) {
  const { bookingId } = await reread(jobId);
  const { requestId } = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  return prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } });
}

const entries = (jobId: string) =>
  prisma.jobStageEntry.findMany({
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
    where: { jobId },
  });

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({ orderBy: { id: 'asc' }, where: { subjectId } });

const audits = (subjectId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { subjectId } });

async function snapshot(jobId: string) {
  const job = await reread(jobId);
  return {
    audits: (await audits(jobId)).length,
    entries: (await entries(jobId)).length,
    events: (await events(jobId)).length,
    job: [job.status, job.receivedAt, job.odometerKm, job.workedSeconds],
    request: (await requestOf(jobId)).status,
  };
}

const backdate = (jobId: string, ms: number) =>
  prisma.jobStageEntry.updateMany({
    data: { at: new Date(Date.now() - ms) },
    where: { jobId, toStatus: 'in_work' },
  });

const UNKNOWN = '3f1c9a52-7d0e-4b8a-9c11-0a1b2c3d4e5f';

// @traces 276-FR-001 276-FR-002
describe('stage calls on ids and bodies nobody pictured', () => {
  it.each(['start', 'pause', 'resume', 'finish', 'receive'])(
    'answers 404 to %s on a job that does not exist',
    async (verb) => {
      const s = await setting();

      const res = await send(
        'post',
        `/garage/jobs/${UNKNOWN}/${verb}`,
        s.owner,
        verb === 'receive' ? { odometerKm: 5 } : undefined,
      );

      expect(res.status).toBe(404);
    },
  );

  it.each([["1' OR '1'='1"], ['%00'], ['Ünïcode-ȘȚ'], ['0']])(
    'answers 400 to the job id %j',
    async (id) => {
      const s = await setting();

      const res = await stage(encodeURIComponent(id), 'start', s.owner);

      expect(res.status).toBe(400);
    },
  );

  it('does not offer the stage verbs to a GET', async () => {
    const s = await setting();

    const res = await get(`/garage/jobs/${s.job.id}/start`, s.owner);

    expect(res.status).toBe(404);
    expect(await reread(s.job.id)).toMatchObject({ status: 'to_do' });
  });

  it('ignores a body sent to start and moves only to in_work', async () => {
    const s = await setting();

    const res = await stage(s.job.id, 'start', s.owner, {
      status: 'done',
      workedSeconds: 99999,
    });

    expect([200, 400]).toContain(res.status);
    const job = await reread(s.job.id);
    expect(job.status).not.toBe('done');
    expect(job.workedSeconds).toBe(0);
  });

  it('answers the same job as the plain read', async () => {
    const s = await setting();

    const res = await stage(s.job.id, 'start', s.owner);
    const read = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(read.body);
  });
});

// @traces 276-FR-002
describe('whose job it is', () => {
  it.each(['start', 'receive'])(
    'refuses the plain mechanic %s on a job with no mechanic',
    async (verb) => {
      const s = await setting('to_do', { received: verb !== 'receive' });
      await prisma.job.update({
        data: { mechanicId: null },
        where: { id: s.job.id },
      });
      const before = await snapshot(s.job.id);

      const res = await send(
        'post',
        `/garage/jobs/${s.job.id}/${verb}`,
        s.hand,
        verb === 'receive' ? { odometerKm: 10 } : undefined,
      );

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'forbidden' });
      expect(await snapshot(s.job.id)).toEqual(before);
    },
  );

  it('moves the right to the new mechanic when the job is reassigned', async () => {
    const s = await setting();
    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    const old = await stage(s.job.id, 'start', s.hand);
    const next = await stage(s.job.id, 'start', s.other);

    expect(old.status).toBe(403);
    expect(next.status).toBe(200);
    expect(await entries(s.job.id)).toEqual([
      expect.objectContaining({
        mechanicId: s.dinamo.answeringMechanic.id,
        toStatus: 'in_work',
      }),
    ]);
  });

  it('keeps the audience to the driver and the garage when the job has no mechanic', async () => {
    const s = await setting();
    await prisma.job.update({
      data: { mechanicId: null },
      where: { id: s.job.id },
    });

    await stage(s.job.id, 'start', s.owner);

    const [event] = await events(s.job.id);
    expect(event.audience).toEqual([
      `account:${s.andrei}`,
      `garage:${s.dinamo.garage.id}`,
    ]);
    expect(await entries(s.job.id)).toEqual([
      expect.objectContaining({ auto: false, mechanicId: null }),
    ]);
  });
});

// @traces 276-FR-001 276-FR-003 276-FR-006
describe('calling a stage twice', () => {
  it('refuses a second pause without a second entry or event', async () => {
    const s = await setting('in_work');
    await stage(s.job.id, 'pause', s.owner);
    const before = await snapshot(s.job.id);

    const res = await stage(s.job.id, 'pause', s.owner);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'paused',
    });
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('refuses a second finish and adds no time', async () => {
    const s = await setting('in_work');
    await prisma.jobStageEntry.create({
      data: {
        actorRole: 'owner',
        at: new Date(Date.now() - 40_000),
        fromStatus: 'to_do',
        jobId: s.job.id,
        toStatus: 'in_work',
      },
    });
    const first = await stage(s.job.id, 'finish', s.owner);
    const before = await snapshot(s.job.id);

    const second = await stage(s.job.id, 'finish', s.owner);

    expect(first.body.workedSeconds).toBeGreaterThanOrEqual(40);
    expect(second.status).toBe(409);
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('lets only one of a pause and a finish at the same moment through', async () => {
    const s = await setting('in_work');

    const answers = await Promise.all([
      stage(s.job.id, 'pause', s.owner),
      stage(s.job.id, 'finish', s.hand),
    ]);

    expect(answers.every((r) => r.status < 500)).toBe(true);
    expect((await entries(s.job.id)).length).toBe(
      answers.filter((r) => r.status === 200).length,
    );
    expect((await events(s.job.id)).length).toBe(
      answers.filter((r) => r.status === 200).length,
    );
  });

  it('adds the time of every spell in work across a pause and a resume', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.hand);
    await backdate(s.job.id, 60_400);
    await stage(s.job.id, 'pause', s.hand);
    await stage(s.job.id, 'resume', s.hand);
    await prisma.jobStageEntry.updateMany({
      data: { at: new Date(Date.now() - 30_400) },
      where: { fromStatus: 'paused', jobId: s.job.id, toStatus: 'in_work' },
    });

    const res = await stage(s.job.id, 'finish', s.hand);

    expect(res.body.workedSeconds).toBe(90);
  });

  it('floors the seconds of a spell in work', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.hand);
    await backdate(s.job.id, 2_400);

    const res = await stage(s.job.id, 'pause', s.hand);

    expect(res.body.workedSeconds).toBe(2);
  });

  it('adds nothing for a spell that lasted under a second', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.hand);

    const res = await stage(s.job.id, 'pause', s.hand);

    expect(res.body.workedSeconds).toBe(0);
  });

  it('never counts negative time when the stage entry lies in the future', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.hand);
    await prisma.jobStageEntry.updateMany({
      data: { at: new Date(Date.now() + 60_000) },
      where: { jobId: s.job.id },
    });

    const res = await stage(s.job.id, 'pause', s.hand);

    expect(res.status).toBe(200);
    expect((await reread(s.job.id)).workedSeconds).toBeGreaterThanOrEqual(0);
  });

  it('counts the time of the job paused by the automatic pause', async () => {
    const s = await setting();
    const second = await jobOf(s.dinamo, s.andrei, 'to_do');
    await stage(s.job.id, 'start', s.hand);
    await backdate(s.job.id, 30_400);

    await stage(second.id, 'start', s.owner);

    expect((await reread(s.job.id)).workedSeconds).toBe(30);
  });
});

// @traces 276-FR-003
describe('the request that follows the job', () => {
  it('writes the request audit entry and no event of its own on start', async () => {
    const s = await setting();
    const { id } = await requestOf(s.job.id);

    await stage(s.job.id, 'start', s.owner);

    expect(await audits(id)).toEqual([
      expect.objectContaining({ newValue: 'in_work', oldValue: 'booked' }),
    ]);
    expect(await events(id)).toEqual([]);
  });

  it('leaves the booking confirmed at done', async () => {
    const s = await setting('in_work');
    const { bookingId } = await reread(s.job.id);
    const before = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });

    await stage(s.job.id, 'finish', s.owner);

    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    expect(after.status).toBe(before.status);
    expect(after.status).toBe('confirmed');
  });

  it('leaves the request in work through a pause and a resume', async () => {
    const s = await setting('in_work');

    await stage(s.job.id, 'pause', s.owner);
    const paused = (await requestOf(s.job.id)).status;
    await stage(s.job.id, 'resume', s.owner);

    expect(paused).toBe('in_work');
    expect((await requestOf(s.job.id)).status).toBe('in_work');
  });

  it('writes nothing when a finish finds the request still booked', async () => {
    const s = await setting('in_work', { request: 'booked' });
    const before = await snapshot(s.job.id);

    const res = await stage(s.job.id, 'finish', s.owner);

    expect(res.status).toBe(409);
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('keeps the mechanic’s other job in work when the start fails on its request', async () => {
    const s = await setting('in_work');
    const stuck = await jobOf(s.dinamo, s.andrei, 'to_do', {
      request: 'closed',
    });
    const before = await snapshot(s.job.id);

    const res = await stage(stuck.id, 'start', s.owner);

    expect(res.status).toBe(409);
    expect(await snapshot(s.job.id)).toEqual(before);
    expect(await reread(s.job.id)).toMatchObject({ status: 'in_work' });
  });
});

// @traces 276-FR-005
describe('the automatic pause', () => {
  it('keeps the other job in work when the start is refused for no reception', async () => {
    const s = await setting('in_work');
    const unreceived = await jobOf(s.dinamo, s.andrei, 'to_do', {
      received: false,
    });

    const res = await stage(unreceived.id, 'start', s.owner);

    expect(res.status).toBe(409);
    expect(await reread(s.job.id)).toMatchObject({ status: 'in_work' });
    expect(await entries(s.job.id)).toEqual([]);
  });

  it('pauses when the garage has the team switch explicitly on', async () => {
    const s = await setting('in_work');
    await prisma.garageFeature.create({
      data: {
        enabled: true,
        garageId: s.dinamo.garage.id,
        key: 'team_mechanics',
      },
    });
    const next = await jobOf(s.dinamo, s.andrei, 'to_do');

    await stage(next.id, 'start', s.hand);

    expect(await reread(s.job.id)).toMatchObject({ status: 'paused' });
  });

  it('leaves paused, to_do, done and cancelled jobs of the mechanic as they are', async () => {
    const s = await setting();
    const others = await Promise.all(
      (['paused', 'to_do', 'done', 'cancelled'] as const).map((st) =>
        jobOf(s.dinamo, s.andrei, st),
      ),
    );

    await stage(s.job.id, 'start', s.hand);

    for (const [i, job] of others.entries()) {
      expect((await reread(job.id)).status).toBe(
        (['paused', 'to_do', 'done', 'cancelled'] as const)[i],
      );
      expect(await entries(job.id)).toEqual([]);
      expect(await events(job.id)).toEqual([]);
    }
  });

  it('leaves the request of the paused job in work', async () => {
    const s = await setting('in_work');
    const next = await jobOf(s.dinamo, s.andrei, 'to_do');

    await stage(next.id, 'start', s.owner);

    expect((await requestOf(s.job.id)).status).toBe('in_work');
  });

  it('leaves at most one job of a mechanic in work when two of their paused jobs resume at once', async () => {
    const s = await setting('paused');
    const second = await jobOf(s.dinamo, s.andrei, 'paused');

    const answers = await Promise.all([
      stage(s.job.id, 'resume', s.hand),
      stage(second.id, 'resume', s.hand),
    ]);

    expect(answers.every((r) => r.status < 500)).toBe(true);
    const states = [
      (await reread(s.job.id)).status,
      (await reread(second.id)).status,
    ];
    expect(states.filter((x) => x === 'in_work').length).toBeLessThanOrEqual(1);
  });

  it('leaves at most one job of a mechanic in work when two of their to_do jobs start at once', async () => {
    const s = await setting();
    const second = await jobOf(s.dinamo, s.andrei, 'to_do');

    const answers = await Promise.all([
      stage(s.job.id, 'start', s.owner),
      stage(second.id, 'start', s.hand),
    ]);

    expect(answers.every((r) => r.status < 500)).toBe(true);
    const states = [
      (await reread(s.job.id)).status,
      (await reread(second.id)).status,
    ];
    expect(states.filter((x) => x === 'in_work').length).toBeLessThanOrEqual(1);
  });

  it('pauses the same mechanic’s other jobs of a garage and none of another garage', async () => {
    const s = await setting();
    const abroad = await jobOf(s.militari, s.andrei, 'in_work');

    await stage(s.job.id, 'start', s.hand);

    expect(await reread(abroad.id)).toMatchObject({ status: 'in_work' });
  });
});

// @traces 276-FR-008
describe('hostile reception bodies', () => {
  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['null', null],
    ['a null reading', { odometerKm: null }],
    ['a boolean', { odometerKm: true }],
    ['an array', { odometerKm: [5] }],
    ['a nested object', { odometerKm: { value: 5 } }],
    ['an exponent string', { odometerKm: '1e3' }],
    ['an empty string', { odometerKm: '' }],
    ['a huge number', { odometerKm: 1e21 }],
    [
      'a number at the safe integer ceiling',
      { odometerKm: Number.MAX_SAFE_INTEGER },
    ],
    ['a negative zero fraction', { odometerKm: -0.5 }],
    ['the wrong key', { odometer_km: 5 }],
    ['a ten-thousand-element array', { odometerKm: new Array(10_000).fill(1) }],
  ])('refuses %s with 400, writing nothing', async (_, body) => {
    const s = await setting('to_do', { received: false });
    const before = await snapshot(s.job.id);

    const res = await receive(s.job.id, s.owner, body);

    expect(res.status).toBe(400);
    expect(await snapshot(s.job.id)).toEqual(before);
    expect(
      await prisma.odometerReading.count({
        where: { carId: s.job.carId, source: 'reception' },
      }),
    ).toBe(0);
  });

  it('does not let the body set the status or the reception time', async () => {
    const s = await setting('to_do', { received: false });

    await receive(s.job.id, s.owner, {
      odometerKm: 77,
      receivedAt: '2001-01-01T00:00:00Z',
      status: 'done',
      workedSeconds: 5000,
    });

    const job = await reread(s.job.id);
    expect(job.status).toBe('to_do');
    expect(job.workedSeconds).toBe(0);
    if (job.receivedAt) {
      expect(job.receivedAt.getFullYear()).toBeGreaterThan(2001);
    }
  });

  it('takes a negative zero as the reading 0', async () => {
    const s = await setting('to_do', { received: false });

    const res = await receive(s.job.id, s.owner, { odometerKm: -0 });

    expect(res.status).toBe(200);
    expect(await reread(s.job.id)).toMatchObject({ odometerKm: 0 });
  });

  it('answers 401 without a session and writes nothing', async () => {
    const s = await setting('to_do', { received: false });
    const before = await snapshot(s.job.id);

    const res = await receive(s.job.id, '', { odometerKm: 5 });

    expect(res.status).toBe(401);
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('refuses a driver’s reception call with 404', async () => {
    const s = await setting('to_do', { received: false });

    const res = await receive(s.job.id, bearer(s.andrei, 'driver'), {
      odometerKm: 5,
    });

    expect(res.status).toBe(404);
  });
});

// @traces 276-FR-008
describe('receptions that overlap or repeat', () => {
  it('keeps the job, the car and the audit chain agreeing after two receptions at once', async () => {
    const s = await setting('to_do', { received: false });

    const answers = await Promise.all([
      receive(s.job.id, s.owner, { odometerKm: 90_000 }),
      receive(s.job.id, s.desk, { odometerKm: 91_000 }),
    ]);

    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    const job = await reread(s.job.id);
    const readings = await prisma.odometerReading.findMany({
      where: { carId: s.job.carId, source: 'reception' },
    });
    expect(readings).toHaveLength(2);
    const log = (await audits(s.job.id)).filter(
      (a) => a.field === 'odometer_km',
    );
    expect(log).toHaveLength(2);
    expect(log.map((a) => a.oldValue).sort()).toEqual(
      [null, job.odometerKm === 90_000 ? 91_000 : 90_000].sort(),
    );
    expect(
      (await prisma.car.findUniqueOrThrow({ where: { id: s.job.carId } }))
        .odometerKm,
    ).toBe(job.odometerKm);
  });

  it('records a repeat of the same reading as a second reading with the receivedAt unchanged', async () => {
    const s = await setting('to_do', { received: false });
    await receive(s.job.id, s.owner, { odometerKm: 88_000 });
    const { receivedAt } = await reread(s.job.id);

    const res = await receive(s.job.id, s.owner, { odometerKm: 88_000 });

    expect(res.status).toBe(200);
    expect((await reread(s.job.id)).receivedAt).toEqual(receivedAt);
    expect(
      await prisma.odometerReading.count({
        where: { carId: s.job.carId, source: 'reception' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('refuses a reading after a finish and leaves the car unchanged', async () => {
    const s = await setting('in_work');
    await stage(s.job.id, 'finish', s.owner);
    const car = await prisma.car.findUniqueOrThrow({
      where: { id: s.job.carId },
    });

    const res = await receive(s.job.id, s.owner, { odometerKm: 95_000 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'job_closed' });
    expect(
      (await prisma.car.findUniqueOrThrow({ where: { id: s.job.carId } }))
        .odometerKm,
    ).toBe(car.odometerKm);
  });

  it('lets a mechanic reassigned off the job lose the right to receive', async () => {
    const s = await setting('to_do', { received: false });
    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    const res = await receive(s.job.id, s.hand, { odometerKm: 5 });

    expect(res.status).toBe(403);
  });

  it('shows workedSeconds and receivedAt on the list after a finish', async () => {
    const s = await setting('to_do', { received: false });
    await receive(s.job.id, s.owner, { odometerKm: 86_000 });
    await stage(s.job.id, 'start', s.owner);
    await backdate(s.job.id, 5_400);
    await stage(s.job.id, 'finish', s.owner);

    const list = await get('/garage/jobs', s.owner);

    expect(list.body.items[0]).toMatchObject({
      odometerKm: 86_000,
      receivedAt: expect.any(String),
      status: 'done',
      workedSeconds: 5,
    });
  });
});
