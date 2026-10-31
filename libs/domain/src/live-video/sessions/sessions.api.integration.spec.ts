import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { LiveSessionsService } from './sessions.service';
import type { AuditPort } from '../../audit/audit.port';
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

// A BMW job at Atelier Dinamo in Costel's hands, and a second garage.
async function setting(status: JobStatus = 'in_work') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  await prisma.account.update({
    data: { name: '  Costel Ionescu  ' },
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
    job,
    live: `/jobs/${job.id}/live`,
    militari,
    owner: bearer(dinamo.owner, 'garage'),
  };
}

const start = (path: string, auth: string) => send('post', path, auth);

const sessions = (jobId: string) =>
  prisma.liveSession.findMany({
    orderBy: { startedAt: 'asc' },
    where: { jobId },
  });

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: { startsWith: 'live.' }, subjectId },
  });

const audits = (jobId: string) =>
  prisma.activityLog.findMany({
    where: { jobId, subjectType: 'live_session' },
  });

const fake = () => provider<LiveVideoProvider>(LIVE_VIDEO_PROVIDER);

async function nothingWritten(jobId: string) {
  expect(await sessions(jobId)).toEqual([]);
  expect(await events(jobId)).toEqual([]);
  expect(await audits(jobId)).toEqual([]);
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// @traces 1250-FR-002 1250-FR-007 1250-FR-011
describe('starting a live stream on a job', () => {
  it.each([
    ['the job’s mechanic', 'costel', 'mechanic', 'mechanic'],
    ['the garage’s owner', 'owner', 'garage', 'owner'],
  ] as const)(
    'lets %s go live with a video-only publish credential',
    async (_who, key, role, recorded) => {
      const s = await setting();
      const before = Date.now();

      const res = await start(s.live, s[key]);

      expect(res.status).toBe(201);
      const startedAt = Date.parse(res.body.startedAt);
      expect(startedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(res.body).toEqual({
        liveSessionId: expect.any(String),
        publish: {
          constraints: {
            audio: false,
            video: { maxBitrateKbps: 1500, maxHeight: 720 },
          },
          expiresAt: new Date(startedAt + 120_000).toISOString(),
          url: expect.stringMatching(/^https:\/\//),
        },
        startedAt: expect.any(String),
      });
      const starter = role === 'mechanic' ? s.dinamo.plain : s.dinamo.owner;
      const [row] = await sessions(s.job.id);
      expect(row).toMatchObject({
        garageId: s.dinamo.garage.id,
        id: res.body.liveSessionId,
        provider: 'fake',
        providerInputId: expect.any(String),
        startedBy: starter,
        stoppedAt: null,
        stopReason: null,
      });
      expect(await audits(s.job.id)).toEqual([
        expect.objectContaining({
          action: 'create',
          actorId: starter,
          actorRole: recorded,
          garageId: s.dinamo.garage.id,
          newValue: 'live',
          subjectId: row?.id,
        }),
      ]);
      const [event] = await events(s.job.id);
      expect(event).toMatchObject({
        kind: 'live.started',
        payload: { jobId: s.job.id, liveSessionId: row?.id },
      });
      expect([...(event?.audience ?? [])].sort()).toEqual(
        [
          `account:${s.andrei}`,
          `garage:${s.dinamo.garage.id}`,
          `mechanic:${s.dinamo.plainMechanic.id}`,
        ].sort(),
      );
    },
  );

  it('lets a job waiting to be started or paused go live', async () => {
    for (const status of ['to_do', 'paused'] as const) {
      const s = await setting(status);

      expect((await start(s.live, s.costel)).status).toBe(201);
    }
  });

  it('starts a new session once the last one has stopped', async () => {
    const s = await setting();
    await start(s.live, s.costel);
    await prisma.liveSession.updateMany({
      data: { stoppedAt: new Date(), stopReason: 'job_closed' },
      where: { jobId: s.job.id },
    });

    expect((await start(s.live, s.owner)).status).toBe(201);
    expect(await sessions(s.job.id)).toHaveLength(2);
  });
});

// @traces 1250-FR-004 1250-FR-005
describe('a start that is refused', () => {
  it('answers 404 to everyone without the right, and writes nothing', async () => {
    const s = await setting();
    const admin = await world.account('Ana Admin', ['admin']);
    const callers = [
      bearer(s.dinamo.receptionist, 'receptionist'),
      bearer(s.dinamo.answering, 'mechanic'),
      bearer(s.andrei, 'driver'),
      bearer(s.militari.owner, 'garage'),
      bearer(s.militari.plain, 'mechanic'),
      bearer(admin, 'admin'),
    ];

    for (const auth of callers)
      expect((await start(s.live, auth)).status).toBe(404);
    expect((await start(`/jobs/${randomUUID()}/live`, s.owner)).status).toBe(
      404,
    );
    await nothingWritten(s.job.id);
  });

  it('answers 404 while the garage has live media off', async () => {
    const s = await setting('done');
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    expect((await start(s.live, s.costel)).status).toBe(404);
    expect((await start(s.live, s.owner)).status).toBe(404);
    await nothingWritten(s.job.id);
  });

  it('answers 401 without a session', async () => {
    const s = await setting();

    const res = await send('post', s.live, '');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('answers 400 to a malformed job id', async () => {
    const s = await setting();

    expect((await start('/jobs/not-a-uuid/live', s.owner)).status).toBe(400);
  });

  it('names who is already live, in the caller’s language', async () => {
    const s = await setting();
    await start(s.live, s.costel);
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: s.dinamo.owner },
    });

    const ro = await start(s.live, s.costel);
    const en = await start(s.live, s.owner);

    expect(ro.status).toBe(409);
    expect(ro.body).toMatchObject({
      code: 'live_already_on',
      message: 'Costel Ionescu transmite deja',
    });
    expect(en.status).toBe(409);
    expect(en.body).toMatchObject({
      code: 'live_already_on',
      message: 'Costel Ionescu is already live',
    });
    expect(await sessions(s.job.id)).toHaveLength(1);
    expect(await events(s.job.id)).toHaveLength(1);
  });

  it.each(['done', 'cancelled'] as const)(
    'refuses a job that is %s',
    async (status) => {
      const s = await setting(status);

      const res = await start(s.live, s.costel);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'job_closed' });
      await nothingWritten(s.job.id);
    },
  );

  it('keeps one session when two starts race, and closes the loser’s input', async () => {
    const s = await setting();
    const create = jest.spyOn(fake(), 'createInput');
    const close = jest.spyOn(fake(), 'deleteInput');

    const answers = await Promise.all([
      start(s.live, s.costel),
      start(s.live, s.owner),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)?.body).toMatchObject({
      code: 'live_already_on',
    });
    const rows = await sessions(s.job.id);
    expect(rows).toHaveLength(1);
    expect(await events(s.job.id)).toHaveLength(1);
    expect(await audits(s.job.id)).toHaveLength(1);
    const opened = await Promise.all(
      create.mock.results.map(
        async (r) => (await r.value) as { inputId: string },
      ),
    );
    expect(close.mock.calls.map(([inputId]) => inputId)).toEqual(
      opened
        .map((input) => input.inputId)
        .filter((inputId) => inputId !== rows[0]?.providerInputId),
    );
  });

  it('closes the input and writes nothing when the session cannot be saved, logging an input it could not close', async () => {
    const s = await setting();
    const warn = jest.mocked(Logger.prototype.warn);
    const service = provider(LiveSessionsService) as unknown as {
      audit: AuditPort;
    };
    jest
      .spyOn(service.audit, 'record')
      .mockRejectedValueOnce(new Error('audit down'));
    const create = jest.spyOn(fake(), 'createInput');
    jest
      .spyOn(fake(), 'deleteInput')
      .mockRejectedValueOnce(new Error('close failed'));

    const res = await start(s.live, s.costel);

    expect(res.status).toBe(500);
    await nothingWritten(s.job.id);
    const input = (await create.mock.results[0]?.value) as { inputId: string };
    expect(warn).toHaveBeenCalledWith(
      `live input not deleted: ${input.inputId} Error`,
    );
  });

  it('is not left live when live media is switched off while it starts', async () => {
    const s = await setting();
    const garageId = s.dinamo.garage.id;
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const switching = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
        locked();
        await held;
        await tx.garageFeature.create({
          data: { enabled: false, garageId, key: 'live_media' },
        });
      },
      { timeout: 10_000 },
    );
    await isLocked;

    const answer = start(s.live, s.costel);
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await switching;

    expect((await answer).status).toBe(404);
    expect(await sessions(s.job.id)).toEqual([]);
  });

  it.each([
    ['no provider is configured', () => ({ unavailable: 'not_configured' })],
    ['the provider fails', () => ({ unavailable: '502' })],
    [
      'the provider throws',
      () => {
        throw new Error('socket hang up');
      },
    ],
  ])(
    'answers 503 when %s, offering photos and clips instead',
    async (_name, impl) => {
      const s = await setting();
      jest
        .spyOn(fake(), 'createInput')
        .mockImplementation(async () => impl() as never);
      await prisma.account.update({
        data: { language: 'en' },
        where: { id: s.dinamo.owner },
      });

      const ro = await start(s.live, s.costel);
      const en = await start(s.live, s.owner);

      expect(ro.status).toBe(503);
      expect(ro.body).toMatchObject({
        code: 'live_unavailable',
        message:
          'Transmisia live nu e disponibilă acum. Poți trimite fotografii și clipuri.',
      });
      expect(en.status).toBe(503);
      expect(en.body).toMatchObject({
        code: 'live_unavailable',
        message: 'Live is not available now. You can send photos and clips.',
      });
      await nothingWritten(s.job.id);
    },
  );

  it('logs a refused start by ids and code alone', async () => {
    const s = await setting('done');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await start(s.live, s.costel);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('job_closed');
    expect(logged).toContain(s.job.id);
    expect(logged).not.toContain('Costel');
  });
});
