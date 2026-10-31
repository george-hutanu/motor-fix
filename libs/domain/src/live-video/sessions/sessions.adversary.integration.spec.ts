import { Logger } from '@nestjs/common';

import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { LiveVideoModule } from '../live-video.module';
import {
  LIVE_VIDEO_PROVIDER,
  type LiveVideoProvider,
} from '../providers/live-video.provider';

const { bearer, provider, send, team, world } = quotesApp([
  LiveVideoModule.register({ provider: 'fake' }),
]);
const { prisma } = world;

async function setting(
  status: JobStatus = 'in_work',
  costelName = 'Costel Ionescu',
) {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  await prisma.account.update({
    data: { name: costelName },
    where: { id: dinamo.plain },
  });
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    status,
    { mechanicId: dinamo.plainMechanic.id },
  );
  return {
    andrei,
    costel: bearer(dinamo.plain, 'mechanic'),
    dinamo,
    driver: bearer(andrei, 'driver'),
    job,
    live: `/jobs/${job.id}/live`,
    militari,
    owner: bearer(dinamo.owner, 'garage'),
  };
}

const start = (path: string, auth: string) => send('post', path, auth);
const fake = () => provider<LiveVideoProvider>(LIVE_VIDEO_PROVIDER);
const rows = (jobId: string) =>
  prisma.liveSession.findMany({ where: { jobId } });
const written = async (jobId: string) => ({
  audits: await prisma.activityLog.count({
    where: { jobId, subjectType: 'live_session' },
  }),
  events: await prisma.outboxEvent.count({
    where: { kind: { startsWith: 'live.' }, subjectId: jobId },
  }),
  sessions: (await rows(jobId)).length,
});

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

// @traces 1250-FR-005
describe('a start while the provider misbehaves', () => {
  it('answers 503 within the five-second limit when the provider is late, and closes the input it opens afterwards', async () => {
    const s = await setting();
    const close = vi.spyOn(fake(), 'closeInput');
    vi.spyOn(fake(), 'createInput').mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ inputId: 'late', publishUrl: 'https://x.test/p' }),
            6000,
          ),
        ),
    );
    const started = Date.now();

    const res = await start(s.live, s.costel);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'live_unavailable' });
    expect(Date.now() - started).toBeLessThan(7000);
    expect(await written(s.job.id)).toEqual({
      audits: 0,
      events: 0,
      sessions: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(close).toHaveBeenCalledWith('late');
  }, 15_000);

  it('never repeats the provider’s error text, url or token in the answer', async () => {
    const s = await setting();
    vi.spyOn(fake(), 'createInput').mockRejectedValue(
      new Error('https://api.cloudflare.com/x?token=SECRET-TOKEN-123 refused'),
    );

    const res = await start(s.live, s.owner);

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET-TOKEN-123|cloudflare/);
  });

  it('counts the warning for a failed provider without a secret or a person', async () => {
    const s = await setting();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    vi.spyOn(fake(), 'createInput').mockRejectedValue(
      new Error('boom https://x/?token=SECRET-TOKEN-123'),
    );

    await start(s.live, s.costel);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(s.job.id);
    expect(logged).not.toContain('SECRET-TOKEN-123');
    expect(logged).not.toContain('Costel');
  });

  it('can start again right after a failed start', async () => {
    const s = await setting();
    vi.spyOn(fake(), 'createInput').mockResolvedValueOnce({
      unavailable: 'timeout',
    });

    expect((await start(s.live, s.costel)).status).toBe(503);
    const again = await start(s.live, s.costel);

    expect(again.status).toBe(201);
    expect(await rows(s.job.id)).toHaveLength(1);
  });

  it('gives the provider the session id alone, and returns that same id', async () => {
    const s = await setting();
    const create = vi.spyOn(fake(), 'createInput');

    const res = await start(s.live, s.costel);

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({ id: res.body.liveSessionId });
  });

  it('answers 409 and closes the created input when a live session appears during the provider call', async () => {
    const s = await setting();
    const close = vi.spyOn(fake(), 'closeInput');
    const real = fake().createInput.bind(fake());
    let made = '';
    vi.spyOn(fake(), 'createInput').mockImplementation(async (session) => {
      await prisma.liveSession.create({
        data: {
          garageId: s.dinamo.garage.id,
          jobId: s.job.id,
          provider: 'fake',
          providerInputId: 'rival',
          startedBy: s.dinamo.owner,
        },
      });
      const input = await real(session);
      if ('inputId' in input) made = input.inputId;
      return input;
    });

    const res = await start(s.live, s.costel);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'live_already_on' });
    expect(close).toHaveBeenCalledWith(made);
    expect(await rows(s.job.id)).toHaveLength(1);
  });

  it('still answers 409 when closing the loser’s input throws', async () => {
    const s = await setting();
    vi.spyOn(fake(), 'closeInput').mockRejectedValue(new Error('close failed'));
    const real = fake().createInput.bind(fake());
    vi.spyOn(fake(), 'createInput').mockImplementation(async (session) => {
      await prisma.liveSession.create({
        data: {
          garageId: s.dinamo.garage.id,
          jobId: s.job.id,
          provider: 'fake',
          providerInputId: 'rival',
          startedBy: s.dinamo.owner,
        },
      });
      return real(session);
    });

    const res = await start(s.live, s.costel);

    expect(res.status).toBe(409);
  });
});

// @traces 1250-FR-004
describe('a start that must not reach the provider', () => {
  it('does not call the provider for a refused caller, a closed job or a live job', async () => {
    const closed = await setting('done');
    const busy = await setting();
    await start(busy.live, busy.costel);
    const create = vi.spyOn(fake(), 'createInput');

    const answers = [
      await start(closed.live, closed.costel),
      await start(busy.live, busy.owner),
      await start(busy.live, bearer(busy.dinamo.receptionist, 'receptionist')),
      await start(busy.live, bearer(busy.andrei, 'driver')),
      await start(busy.live, bearer(busy.militari.owner, 'garage')),
    ];

    expect(answers.map((a) => a.status)).toEqual([409, 409, 404, 404, 404]);
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 404 to a driver who claims the garage role', async () => {
    const s = await setting();

    expect((await start(s.live, bearer(s.andrei, 'garage'))).status).toBe(404);
    expect((await start(s.live, bearer(s.andrei, 'mechanic'))).status).toBe(
      404,
    );
    expect(await written(s.job.id)).toEqual({
      audits: 0,
      events: 0,
      sessions: 0,
    });
  });

  it('goes live when live media is switched on by an explicit row', async () => {
    const s = await setting();
    await prisma.garageFeature.create({
      data: { enabled: true, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    expect((await start(s.live, s.costel)).status).toBe(201);
  });

  it('ignores another garage having live media off', async () => {
    const s = await setting();
    await prisma.garageFeature.create({
      data: {
        enabled: false,
        garageId: s.militari.garage.id,
        key: 'live_media',
      },
    });

    expect((await start(s.live, s.costel)).status).toBe(201);
  });

  it('hands the job to the new mechanic after a reassignment', async () => {
    const s = await setting();
    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    expect((await start(s.live, s.costel)).status).toBe(404);
    expect(
      (await start(s.live, bearer(s.dinamo.answering, 'mechanic'))).status,
    ).toBe(201);
  });

  it('ignores a request body sent with the start', async () => {
    const s = await setting();

    const res = await send('post', s.live, s.costel, {
      garageId: s.militari.garage.id,
      startedBy: s.militari.owner,
    });

    expect(res.status).toBe(201);
    const [row] = await rows(s.job.id);
    expect(row).toMatchObject({
      garageId: s.dinamo.garage.id,
      startedBy: s.dinamo.plain,
    });
  });
});

// @traces 1250-FR-004
describe('the name in the already-live answer', () => {
  it.each([
    ['Costel', 'Costel transmite deja'],
    ['  Ștefan   Țurcanu  ', 'Ștefan   Țurcanu transmite deja'],
    ['Zoë 李', 'Zoë 李 transmite deja'],
  ])('shows the starter named %j as %j', async (name, message) => {
    const s = await setting('in_work', name);
    await start(s.live, s.costel);

    const res = await start(s.live, s.owner);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(message);
  });
});

// @traces 1250-FR-004
describe('five starts at once', () => {
  it('leave one session, one event, one audit entry and four 409s', async () => {
    const s = await setting();
    const callers = [s.costel, s.owner, s.costel, s.owner, s.costel];

    const answers = await Promise.all(callers.map((c) => start(s.live, c)));

    expect(answers.map((a) => a.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
    expect(await written(s.job.id)).toEqual({
      audits: 1,
      events: 1,
      sessions: 1,
    });
  });
});

async function live() {
  const s = await setting();
  const started = await start(s.live, s.costel);
  expect(started.status).toBe(201);
  const id: string = started.body.liveSessionId;
  return { ...s, id, view: `/live-sessions/${id}/view-token` };
}

// @traces 1250-FR-003
describe('asking for a view credential', () => {
  it('gives the same answer shape twice and writes no audit or event either time', async () => {
    const s = await live();
    const before = await written(s.job.id);

    const first = await send('post', s.view, s.driver);
    const second = await send('post', s.view, s.driver);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(Date.parse(second.body.expiresAt)).toBeGreaterThanOrEqual(
      Date.parse(first.body.expiresAt),
    );
    expect(await written(s.job.id)).toEqual(before);
  });

  it('accepts the id in capital letters', async () => {
    const s = await live();

    const res = await send(
      'post',
      `/live-sessions/${s.id.toUpperCase()}/view-token`,
      s.driver,
    );

    expect(res.status).toBe(200);
  });

  it('answers 404 to the former mechanic once the job has another', async () => {
    const s = await live();
    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    expect((await send('post', s.view, s.costel)).status).toBe(404);
    expect(
      (await send('post', s.view, bearer(s.dinamo.answering, 'mechanic')))
        .status,
    ).toBe(200);
  });

  it('answers 404 while live media is off even if the session row is still live', async () => {
    const s = await live();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    expect((await send('post', s.view, s.driver)).status).toBe(404);
    expect((await send('post', s.view, s.owner)).status).toBe(404);
    expect((await send('post', s.view, s.costel)).status).toBe(404);
  });

  it('answers 404 to another driver who claims a staff role', async () => {
    const s = await live();
    const dan = await world.account('Dan Pop', ['driver']);

    expect((await send('post', s.view, bearer(dan, 'garage'))).status).toBe(
      404,
    );
    expect((await send('post', s.view, bearer(dan, 'mechanic'))).status).toBe(
      404,
    );
  });

  it('answers sixty simultaneous requests for one session with 200 each', async () => {
    const s = await live();
    const callers = [s.driver, s.owner, s.costel];

    const answers = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        send('post', s.view, callers[i % 3] as string),
      ),
    );

    expect(answers.filter((a) => a.status === 200)).toHaveLength(60);
  });

  it('answers 409 live_ended to all three roles once the session stops', async () => {
    const s = await live();
    await prisma.liveSession.update({
      data: { stoppedAt: new Date(), stopReason: 'job_closed' },
      where: { id: s.id },
    });

    for (const who of [s.driver, s.owner, s.costel]) {
      const res = await send('post', s.view, who);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'live_ended' });
    }
  });

  it('answers 404 for a stopped session to someone with no right', async () => {
    const s = await live();
    await prisma.liveSession.update({
      data: { stoppedAt: new Date(), stopReason: 'job_closed' },
      where: { id: s.id },
    });

    expect(
      (await send('post', s.view, bearer(s.militari.owner, 'garage'))).status,
    ).toBe(404);
  });
});
