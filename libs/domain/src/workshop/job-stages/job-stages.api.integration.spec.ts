import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { localDay } from '../../bucharest';
import type {
  JobStatus,
  QuoteRequestStatus,
} from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, provider, send, team, world } = quotesApp();
const { prisma } = world;

// The request's status that goes with a job's.
const REQUEST_OF: Record<JobStatus, QuoteRequestStatus> = {
  cancelled: 'booked',
  done: 'done',
  in_work: 'in_work',
  paused: 'in_work',
  to_do: 'booked',
};

type Team = Awaited<ReturnType<typeof team>>;

// A received job of the plain mechanic at Atelier Dinamo, and a second garage.
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

const stage = (jobId: string, verb: string, auth: string) =>
  send('post', `/garage/jobs/${jobId}/${verb}`, auth);

const receive = (jobId: string, auth: string, body: object) =>
  send('post', `/garage/jobs/${jobId}/receive`, auth, body);

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

const audits = (jobId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: jobId },
  });

// What a refused call must leave as it found.
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

// @traces 276-FR-001 276-FR-003 276-FR-007
describe('starting and finishing a job', () => {
  it.each([
    ['owner', 'owner'],
    ['job’s mechanic', 'hand'],
  ] as const)(
    'lets the %s start it, moving the request with it',
    async (_, who) => {
      const s = await setting();

      const res = await stage(s.job.id, 'start', s[who]);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: s.job.id,
        startedAt: expect.any(String),
        status: 'in_work',
      });
      expect(await reread(s.job.id)).toMatchObject({
        startedAt: expect.any(Date),
        status: 'in_work',
      });
      expect((await requestOf(s.job.id)).status).toBe('in_work');
      expect(await entries(s.job.id)).toEqual([
        expect.objectContaining({
          actorId: who === 'owner' ? s.dinamo.owner : s.dinamo.plain,
          auto: false,
          fromStatus: 'to_do',
          mechanicId: s.dinamo.plainMechanic.id,
          toStatus: 'in_work',
        }),
      ]);
      const [event] = await events(s.job.id);
      expect(event).toMatchObject({
        audience: [
          `account:${s.andrei}`,
          `garage:${s.dinamo.garage.id}`,
          `mechanic:${s.dinamo.plainMechanic.id}`,
        ],
        kind: 'job.started',
        payload: { from: 'to_do', pausedJobIds: [], to: 'in_work' },
      });
      expect(await events(s.job.id)).toHaveLength(1);
      expect(await audits(s.job.id)).toEqual([
        expect.objectContaining({
          field: 'status',
          isKeyChange: true,
          newValue: 'in_work',
          oldValue: 'to_do',
        }),
      ]);
    },
  );

  it.each([['in_work'], ['paused']] as const)(
    'finishes a job that is %s, moving the request to done',
    async (from) => {
      const s = await setting(from);

      const res = await stage(s.job.id, 'finish', s.owner);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'done' });
      expect(await reread(s.job.id)).toMatchObject({
        finishedAt: expect.any(Date),
        status: 'done',
      });
      expect((await requestOf(s.job.id)).status).toBe('done');
      expect(await events(s.job.id)).toEqual([
        expect.objectContaining({
          kind: 'job.done',
          payload: { from, to: 'done' },
        }),
      ]);
    },
  );

  it('refuses to finish a job that has not started', async () => {
    const s = await setting('to_do');
    const before = await snapshot(s.job.id);

    const res = await stage(s.job.id, 'finish', s.owner);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'job_not_started',
      message: 'Lucrarea nu a început',
    });
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('refuses to start a job whose car was not received', async () => {
    const s = await setting('to_do', { received: false });
    const before = await snapshot(s.job.id);

    const res = await stage(s.job.id, 'start', s.owner);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'not_received',
      message: 'Fă recepția mai întâi',
    });
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  const refused: [string, JobStatus][] = [
    ['start', 'in_work'],
    ['start', 'paused'],
    ['start', 'done'],
    ['start', 'cancelled'],
    ['pause', 'to_do'],
    ['pause', 'paused'],
    ['pause', 'done'],
    ['pause', 'cancelled'],
    ['resume', 'to_do'],
    ['resume', 'in_work'],
    ['resume', 'done'],
    ['resume', 'cancelled'],
    ['finish', 'done'],
    ['finish', 'cancelled'],
  ];

  it.each(refused)('refuses to %s a job that is %s', async (verb, status) => {
    const s = await setting(status);
    const before = await snapshot(s.job.id);

    const res = await stage(s.job.id, verb, s.owner);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: status,
    });
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('lets only one of two starts at the same moment through', async () => {
    const s = await setting();

    const answers = await Promise.all([
      stage(s.job.id, 'start', s.owner),
      stage(s.job.id, 'start', s.hand),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await entries(s.job.id)).toHaveLength(1);
    expect(await events(s.job.id)).toHaveLength(1);
  });

  it('writes nothing when the request cannot follow the job', async () => {
    const s = await setting('to_do', { request: 'closed' });
    const before = await snapshot(s.job.id);

    const res = await stage(s.job.id, 'start', s.owner);

    expect(res.status).toBe(409);
    expect(await snapshot(s.job.id)).toEqual(before);
  });
});

// @traces 276-FR-005 276-FR-006 276-FR-007
describe('pausing and resuming a job', () => {
  it('pauses by hand, counting the time in work', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.hand);
    await prisma.jobStageEntry.updateMany({
      data: { at: new Date(Date.now() - 65_000) },
      where: { jobId: s.job.id, toStatus: 'in_work' },
    });

    const res = await stage(s.job.id, 'pause', s.hand);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paused', workedSeconds: 65 });
    expect(await reread(s.job.id)).toMatchObject({
      pausedAt: expect.any(Date),
      status: 'paused',
    });
    expect((await events(s.job.id)).at(-1)).toMatchObject({
      kind: 'job.paused',
      payload: { auto: false, from: 'in_work', to: 'paused' },
    });
  });

  it('resumes, keeping the first start time', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.owner);
    const { startedAt } = await reread(s.job.id);
    await stage(s.job.id, 'pause', s.owner);

    const res = await stage(s.job.id, 'resume', s.owner);

    expect(res.status).toBe(200);
    expect(await reread(s.job.id)).toMatchObject({
      startedAt,
      status: 'in_work',
    });
    expect((await events(s.job.id)).at(-1)).toMatchObject({
      kind: 'job.resumed',
      payload: { from: 'paused', pausedJobIds: [], to: 'in_work' },
    });
    expect((await requestOf(s.job.id)).status).toBe('in_work');
  });

  it('pauses the mechanic’s job in work when the owner starts another of theirs', async () => {
    const s = await setting();
    const second = await jobOf(s.dinamo, s.andrei, 'to_do');
    await stage(s.job.id, 'start', s.hand);

    const res = await stage(second.id, 'start', s.owner);

    expect(res.status).toBe(200);
    expect(await reread(s.job.id)).toMatchObject({ status: 'paused' });
    expect(await reread(second.id)).toMatchObject({ status: 'in_work' });
    expect((await entries(s.job.id)).at(-1)).toMatchObject({
      actorId: null,
      actorRole: 'system',
      auto: true,
      fromStatus: 'in_work',
      mechanicId: s.dinamo.plainMechanic.id,
      toStatus: 'paused',
    });
    expect((await audits(s.job.id)).at(-1)).toMatchObject({
      actorId: null,
      actorRole: 'system',
      field: 'status',
      newValue: 'paused',
    });
    expect((await events(s.job.id)).at(-1)).toMatchObject({
      kind: 'job.paused',
      payload: { auto: true, from: 'in_work', to: 'paused' },
    });
    expect(await events(second.id)).toEqual([
      expect.objectContaining({
        kind: 'job.started',
        payload: { from: 'to_do', pausedJobIds: [s.job.id], to: 'in_work' },
      }),
    ]);
  });

  it('pauses every other job of the mechanic in work on a resume', async () => {
    const s = await setting('paused');
    const busy = [
      await jobOf(s.dinamo, s.andrei, 'in_work'),
      await jobOf(s.dinamo, s.andrei, 'in_work'),
    ];

    const res = await stage(s.job.id, 'resume', s.hand);

    expect(res.status).toBe(200);
    for (const job of busy) {
      expect(await reread(job.id)).toMatchObject({ status: 'paused' });
    }
    const [resumed] = await events(s.job.id);
    expect(resumed).toMatchObject({ kind: 'job.resumed' });
    expect(
      [...(resumed.payload as { pausedJobIds: string[] }).pausedJobIds].sort(),
    ).toEqual(busy.map((j) => j.id).sort());
  });

  it('leaves another mechanic’s job and a job with no mechanic in work', async () => {
    const s = await setting();
    const theirs = await jobOf(s.dinamo, s.andrei, 'in_work', {
      mechanicId: s.dinamo.answeringMechanic.id,
    });
    const nobody = await jobOf(s.dinamo, s.andrei, 'in_work', {
      mechanicId: null,
    });

    await stage(s.job.id, 'start', s.hand);

    expect(await reread(theirs.id)).toMatchObject({ status: 'in_work' });
    expect(await reread(nobody.id)).toMatchObject({ status: 'in_work' });
  });

  it('pauses nothing when the job has no mechanic', async () => {
    const s = await setting();
    const job = await jobOf(s.dinamo, s.andrei, 'to_do', { mechanicId: null });

    const res = await stage(job.id, 'start', s.owner);

    expect(res.status).toBe(200);
    expect(await reread(s.job.id)).toMatchObject({ status: 'to_do' });
    expect((await events(job.id))[0]).toMatchObject({
      payload: { pausedJobIds: [] },
    });
  });

  it('pauses nothing while the garage works without a team', async () => {
    const s = await setting();
    await prisma.garageFeature.create({
      data: {
        enabled: false,
        garageId: s.dinamo.garage.id,
        key: 'team_mechanics',
      },
    });
    const busy = await jobOf(s.dinamo, s.andrei, 'in_work');

    const res = await stage(s.job.id, 'start', s.hand);

    expect(res.status).toBe(200);
    expect(await reread(busy.id)).toMatchObject({ status: 'in_work' });
    expect((await events(s.job.id))[0]).toMatchObject({
      payload: { pausedJobIds: [] },
    });
  });

  it('adds no time on a finish from a pause', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.hand);
    await prisma.jobStageEntry.updateMany({
      data: { at: new Date(Date.now() - 12_000) },
      where: { jobId: s.job.id, toStatus: 'in_work' },
    });
    await stage(s.job.id, 'pause', s.hand);

    const res = await stage(s.job.id, 'finish', s.hand);

    expect(res.body).toMatchObject({ status: 'done', workedSeconds: 12 });
  });
});

// @traces 276-FR-002 276-FR-007
describe('who may move a job', () => {
  const VERBS: [string, JobStatus][] = [
    ['start', 'to_do'],
    ['pause', 'in_work'],
    ['resume', 'paused'],
    ['finish', 'in_work'],
  ];

  it.each(VERBS)(
    'refuses %s to the receptionist and to another mechanic',
    async (verb, status) => {
      const s = await setting(status);
      const before = await snapshot(s.job.id);

      const desk = await stage(s.job.id, verb, s.desk);
      const other = await stage(s.job.id, verb, s.other);

      expect([desk.status, other.status]).toEqual([403, 403]);
      expect(desk.body).toMatchObject({ code: 'forbidden' });
      expect(other.body).toMatchObject({ code: 'forbidden' });
      expect(await snapshot(s.job.id)).toEqual(before);
    },
  );

  it.each(VERBS)(
    'hides the job from another garage on %s',
    async (verb, status) => {
      const s = await setting(status);
      const before = await snapshot(s.job.id);

      const res = await stage(s.job.id, verb, s.stranger);

      expect(res.status).toBe(404);
      expect(await snapshot(s.job.id)).toEqual(before);
    },
  );

  it.each(VERBS)('asks for a session on %s', async (verb, status) => {
    const s = await setting(status);

    const res = await send('post', `/garage/jobs/${s.job.id}/${verb}`, '');

    expect(res.status).toBe(401);
  });

  it('hides the job from a driver, as every garage route does', async () => {
    const s = await setting();

    const res = await stage(s.job.id, 'start', bearer(s.andrei, 'driver'));

    expect(res.status).toBe(404);
  });

  it('answers 400 to a job id that is not a uuid', async () => {
    const s = await setting();

    const res = await stage('job-1', 'start', s.owner);

    expect(res.status).toBe(400);
  });
});

// @traces 276-FR-008 276-FR-009
describe('receiving the car', () => {
  it.each([
    ['owner', 'owner'],
    ['receptionist', 'desk'],
    ['job’s mechanic', 'hand'],
  ] as const)('lets the %s record the reading', async (_, who) => {
    const s = await setting('to_do', { received: false });

    const res = await receive(s.job.id, s[who], { odometerKm: 86_500 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      car: { odometerKm: 86_500 },
      odometerKm: 86_500,
      receivedAt: expect.any(String),
      status: 'to_do',
    });
    expect(await reread(s.job.id)).toMatchObject({
      odometerKm: 86_500,
      receivedAt: expect.any(Date),
      status: 'to_do',
    });
    expect(
      await prisma.odometerReading.findMany({ where: { carId: s.job.carId } }),
    ).toEqual([
      expect.objectContaining({
        km: 86_500,
        readOn: new Date(`${localDay(new Date())}T00:00:00Z`),
        source: 'reception',
        sourceId: s.job.id,
      }),
    ]);
    expect(
      await prisma.car.findUniqueOrThrow({ where: { id: s.job.carId } }),
    ).toMatchObject({ odometerKm: 86_500 });
    expect(
      await prisma.activityLog.findMany({ where: { subjectId: s.job.carId } }),
    ).toEqual([
      expect.objectContaining({
        field: 'odometerKm',
        newValue: 86_500,
        oldValue: 84_000,
        subjectType: 'car',
      }),
    ]);
    expect(await audits(s.job.id)).toEqual([
      expect.objectContaining({
        field: 'odometer_km',
        newValue: 86_500,
        oldValue: null,
      }),
    ]);
    expect(await events(s.job.id)).toEqual([
      expect.objectContaining({
        kind: 'job.received',
        payload: { odometerKm: 86_500 },
      }),
    ]);
    expect(await events(s.job.carId)).toEqual([
      expect.objectContaining({
        kind: 'car.updated',
        payload: expect.objectContaining({ changed: ['odometerKm'] }),
      }),
    ]);
  });

  it('records a reading on a job in work without moving it', async () => {
    const s = await setting('in_work', { received: false });

    const res = await receive(s.job.id, s.owner, { odometerKm: 90_000 });

    expect(res.status).toBe(200);
    expect(await reread(s.job.id)).toMatchObject({
      odometerKm: 90_000,
      status: 'in_work',
    });
  });

  it('takes a second reading as a correction, keeping the first reception time', async () => {
    const s = await setting('to_do', { received: false });
    await receive(s.job.id, s.owner, { odometerKm: 86_500 });
    const { receivedAt } = await reread(s.job.id);

    const res = await receive(s.job.id, s.owner, { odometerKm: 86_050 });

    expect(res.status).toBe(200);
    expect(await reread(s.job.id)).toMatchObject({
      odometerKm: 86_050,
      receivedAt,
    });
    expect(
      await prisma.odometerReading.count({ where: { carId: s.job.carId } }),
    ).toBe(2);
    expect((await audits(s.job.id)).at(-1)).toMatchObject({
      field: 'odometer_km',
      newValue: 86_050,
      oldValue: 86_500,
    });
  });

  it('saves a reading below the car’s odometer as entered, the car following its newest reading', async () => {
    const s = await setting('to_do', { received: false });

    const res = await receive(s.job.id, s.owner, { odometerKm: 1_200 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ car: { odometerKm: 1_200 } });
    expect(await reread(s.job.id)).toMatchObject({ odometerKm: 1_200 });
    expect(
      await prisma.activityLog.findMany({ where: { subjectId: s.job.carId } }),
    ).toEqual([
      expect.objectContaining({
        field: 'odometerKm',
        newValue: 1_200,
        oldValue: 84_000,
      }),
    ]);
  });

  it('leaves the car alone when it already shows the reading', async () => {
    const s = await setting('to_do', { received: false });

    await receive(s.job.id, s.owner, { odometerKm: 84_000 });

    expect(
      await prisma.activityLog.findMany({ where: { subjectId: s.job.carId } }),
    ).toEqual([]);
    expect(await events(s.job.carId)).toEqual([]);
    expect(
      await prisma.odometerReading.count({ where: { carId: s.job.carId } }),
    ).toBe(1);
  });

  it('leaves the car on a reading dated after today', async () => {
    const s = await setting('to_do', { received: false });
    await prisma.odometerReading.create({
      data: {
        carId: s.job.carId,
        km: 90_000,
        readOn: new Date('2099-01-01T00:00:00Z'),
        source: 'driver',
      },
    });

    await receive(s.job.id, s.owner, { odometerKm: 86_500 });

    expect(
      await prisma.car.findUniqueOrThrow({ where: { id: s.job.carId } }),
    ).toMatchObject({ odometerKm: 84_000 });
  });

  it.each([[0], [2_000_000]])('takes the reading %d', async (odometerKm) => {
    const s = await setting('to_do', { received: false });

    const res = await receive(s.job.id, s.owner, { odometerKm });

    expect(res.status).toBe(200);
  });

  it.each([[-1], [2_000_001], [1.5], ['86500']])(
    'refuses the reading %j, writing nothing',
    async (odometerKm) => {
      const s = await setting('to_do', { received: false });
      const before = await snapshot(s.job.id);

      const res = await receive(s.job.id, s.owner, { odometerKm });

      expect(res.status).toBe(400);
      expect(await snapshot(s.job.id)).toEqual(before);
    },
  );

  it.each([
    ['done', 'job_closed'],
    ['cancelled', 'job_closed'],
    ['paused', 'invalid_state'],
  ] as const)('refuses a reading on a %s job', async (status, code) => {
    const s = await setting(status);
    const before = await snapshot(s.job.id);

    const res = await receive(s.job.id, s.owner, { odometerKm: 86_500 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code });
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('refuses another mechanic and hides the job from another garage', async () => {
    const s = await setting('to_do', { received: false });
    const before = await snapshot(s.job.id);

    const other = await receive(s.job.id, s.other, { odometerKm: 86_500 });
    const stranger = await receive(s.job.id, s.stranger, {
      odometerKm: 86_500,
    });

    expect(other.status).toBe(403);
    expect(other.body).toMatchObject({ code: 'forbidden' });
    expect(stranger.status).toBe(404);
    expect(await snapshot(s.job.id)).toEqual(before);
  });

  it('then lets the job start', async () => {
    const s = await setting('to_do', { received: false });
    await receive(s.job.id, s.owner, { odometerKm: 86_500 });

    const res = await stage(s.job.id, 'start', s.owner);

    expect(res.status).toBe(200);
  });
});

// @traces 276-FR-009
describe('reading a job', () => {
  it('shows the reception, the time in work and the car’s odometer', async () => {
    const s = await setting('to_do', { received: false });

    const one = await get(`/garage/jobs/${s.job.id}`, s.owner);
    const list = await get('/garage/jobs', s.owner);

    expect(one.body).toMatchObject({
      car: { odometerKm: 84_000 },
      odometerKm: null,
      receivedAt: null,
      workedSeconds: 0,
    });
    expect(list.body.items[0]).toMatchObject({
      car: { odometerKm: 84_000 },
      odometerKm: null,
      receivedAt: null,
      workedSeconds: 0,
    });
  });

  it('shows who the job’s mechanic was and whether it was automatic on each stage', async () => {
    const s = await setting();
    await stage(s.job.id, 'start', s.owner);

    const res = await get(`/garage/jobs/${s.job.id}`, s.owner);

    expect(res.body.stages).toEqual([
      expect.objectContaining({
        auto: false,
        mechanicId: s.dinamo.plainMechanic.id,
        toStatus: 'in_work',
      }),
    ]);
  });
});

// @traces 395-FR-005
describe('a change based on what the caller last read', () => {
  it('goes through when the caller read the job as it stands', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await receive(s.job.id, s.owner, {
      basedOnUpdatedAt: updatedAt.toISOString(),
      odometerKm: 120_000,
    });

    expect(res.status).toBe(200);
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThan(updatedAt.getTime());
  });

  it('goes through with no basis given', async () => {
    const s = await setting();

    const res = await receive(s.job.id, s.owner, { odometerKm: 120_000 });

    expect(res.status).toBe(200);
  });

  it('refuses a change based on an older read, answering the job as it is', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);
    await receive(s.job.id, s.owner, { odometerKm: 120_000 });
    const before = await snapshot(s.job.id);

    const res = await receive(s.job.id, s.hand, {
      basedOnUpdatedAt: updatedAt.toISOString(),
      odometerKm: 99_000,
    });

    const current = await reread(s.job.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'job_changed',
      job: { id: s.job.id, odometerKm: 120_000 },
      updatedAt: current.updatedAt.toISOString(),
    });
    expect(await snapshot(s.job.id)).toEqual(before);
    expect(current.lockHolderId).toBeNull();
  });

  it('compares the basis to the millisecond', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await send('post', `/garage/jobs/${s.job.id}/start`, s.hand, {
      basedOnUpdatedAt: new Date(updatedAt.getTime() + 1).toISOString(),
    });

    expect([res.status, res.body.code]).toEqual([409, 'job_changed']);
    expect((await reread(s.job.id)).status).toBe('to_do');
  });

  it('answers the holder’s lock before a stale basis', async () => {
    const s = await setting();
    await send('post', `/garage/jobs/${s.job.id}/lock`, s.hand);

    const res = await send('post', `/garage/jobs/${s.job.id}/start`, s.owner, {
      basedOnUpdatedAt: new Date(0).toISOString(),
    });

    expect([res.status, res.body.code]).toEqual([423, 'job_locked']);
  });

  it('leaves the updated time alone on a refused move', async () => {
    const s = await setting();
    const { updatedAt } = await reread(s.job.id);

    const res = await stage(s.job.id, 'finish', s.hand);

    expect(res.status).toBe(409);
    expect((await reread(s.job.id)).updatedAt).toEqual(updatedAt);
  });
});

// @traces 395-FR-006
describe('a change while the lock store is unreachable', () => {
  afterEach(() => jest.restoreAllMocks());

  it('answers try again and applies nothing', async () => {
    const s = await setting();
    const before = await snapshot(s.job.id);
    const redis = provider<Redis>(AUTH_REDIS);
    const down = () => Promise.reject(new Error('Connection is closed.'));
    for (const command of ['set', 'get', 'del', 'eval', 'evalsha'] as const) {
      jest.spyOn(redis, command).mockImplementation(down as never);
    }

    const res = await stage(s.job.id, 'start', s.hand);
    const locking = await send('post', `/garage/jobs/${s.job.id}/lock`, s.hand);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'try_again',
      message: 'Încearcă din nou în câteva secunde',
    });
    expect([locking.status, locking.body.code]).toEqual([503, 'try_again']);
    expect(await snapshot(s.job.id)).toEqual(before);
  });
});
