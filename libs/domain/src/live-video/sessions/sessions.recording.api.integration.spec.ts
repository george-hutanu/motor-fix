import { randomUUID } from 'node:crypto';

import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { quotesApp } from '../../quotes/quotes-api.testing';
import { LiveVideoModule } from '../live-video.module';
import type { FakeLiveVideo } from '../providers/fake-live-video.provider';
import { LIVE_VIDEO_PROVIDER } from '../providers/live-video.provider';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const { bearer, provider, send, team, world } = quotesApp([
  LiveVideoModule.register({ provider: 'fake' }),
]);
const { prisma } = world;

const fake = () => provider<FakeLiveVideo>(LIVE_VIDEO_PROVIDER);
const recordings = (outcome: string) =>
  counterTotal(memory.metricReader, 'motorfix_live_recordings_total', {
    outcome,
  });

// Costel live on Andrei's BMW at Atelier Dinamo, and a second garage.
async function live() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'in_work',
    { mechanicId: dinamo.plainMechanic.id },
  );
  const costel = bearer(dinamo.plain, 'mechanic');
  const res = await send('post', `/jobs/${job.id}/live`, costel);
  expect(res.status).toBe(201);
  const id = res.body.liveSessionId as string;
  const row = await prisma.liveSession.findUniqueOrThrow({ where: { id } });
  return {
    andrei,
    costel,
    dinamo,
    id,
    inputId: row.providerInputId,
    job,
    militari,
    owner: bearer(dinamo.owner, 'garage'),
    recording: `/live-sessions/${id}/recording`,
    stop: `/live-sessions/${id}/stop`,
  };
}

type Live = Awaited<ReturnType<typeof live>>;

const session = (s: Live) =>
  prisma.liveSession.findUniqueOrThrow({ where: { id: s.id } });

const kinds = async (s: Live) =>
  (
    await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: {
        kind: { in: ['live.stopped', 'media.added'] },
        subjectId: s.job.id,
      },
    })
  ).map((e) => e.kind);

const keepEntries = (s: Live) =>
  prisma.activityLog.findMany({
    where: { field: 'keep_recording', subjectId: s.id },
  });

async function untouched(s: Live) {
  const row = await session(s);
  expect(row).toMatchObject({
    keepRecording: true,
    recordingMediaId: null,
    stoppedAt: null,
  });
  expect(await keepEntries(s)).toEqual([]);
  expect(await kinds(s)).toEqual([]);
  expect(await prisma.mediaItem.count({ where: { jobId: s.job.id } })).toBe(0);
  expect(fake().deleted).toEqual([]);
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  fake().deleted.length = 0;
});

// @traces 1251-FR-002
describe('a new live session', () => {
  it('starts with its recording kept and none registered', async () => {
    const s = await live();

    expect(await session(s)).toMatchObject({
      keepRecording: true,
      recordingMediaId: null,
    });
  });
});

// @traces 1251-FR-005 1251-FR-007 1251-FR-010
describe('stopping a live stream and keeping its recording', () => {
  it.each([
    ['the job’s mechanic', 'costel', 'mechanic'],
    ['the garage’s owner', 'owner', 'owner'],
  ] as const)(
    'lets %s stop and keep the recording as the job’s media',
    async (_who, key, recorded) => {
      const s = await live();

      const res = await send('post', s.stop, s[key], {});

      expect(res.status).toBe(200);
      const row = await session(s);
      const [item] = await prisma.mediaItem.findMany({
        where: { jobId: s.job.id },
      });
      expect(item).toMatchObject({
        kind: 'live',
        providerRef: s.inputId,
        senderId: null,
        status: 'visible',
      });
      expect(row).toMatchObject({
        recordingMediaId: item?.id,
        stopReason: 'sender',
      });
      expect(res.body).toEqual({
        keep: true,
        liveSessionId: s.id,
        peakViewers: 0,
        recordingMediaId: item?.id,
        seconds: expect.any(Number),
        stoppedAt: row.stoppedAt?.toISOString(),
        viewedByDriverAt: null,
      });
      expect(res.body.seconds).toBeGreaterThanOrEqual(0);
      expect(await kinds(s)).toEqual(['live.stopped', 'media.added']);
      const actor = key === 'costel' ? s.dinamo.plain : s.dinamo.owner;
      expect(
        await prisma.activityLog.findMany({
          where: { field: 'status', subjectId: s.id },
        }),
      ).toEqual([
        expect.objectContaining({
          actorId: actor,
          actorRole: recorded,
          newValue: 'stopped',
          oldValue: 'live',
        }),
      ]);
      expect(
        await prisma.activityLog.findMany({ where: { subjectId: item?.id } }),
      ).toEqual([
        expect.objectContaining({ action: 'create', actorRole: 'system' }),
      ]);
      expect(fake().deleted).toEqual([]);
    },
  );

  it('honours the session’s choice when the stop names none', async () => {
    const s = await live();
    await send('patch', s.recording, s.costel, { keep: false });

    const res = await send('post', s.stop, s.costel);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ keep: false, recordingMediaId: null });
  });

  it('takes a keep choice given with the stop and audits the change', async () => {
    const s = await live();

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.body).toMatchObject({ keep: false });
    expect((await session(s)).keepRecording).toBe(false);
    expect(await keepEntries(s)).toEqual([
      expect.objectContaining({
        actorId: s.dinamo.plain,
        newValue: false,
        oldValue: true,
      }),
    ]);
  });
});

// @traces 1252-FR-003 1252-FR-004
describe('the stop’s answer on who watched', () => {
  it('says when the driver first joined and the most viewers at once', async () => {
    const s = await live();
    const view = `/live-sessions/${s.id}/view-token`;
    await send('post', view, bearer(s.andrei, 'driver'));
    await send('post', view, s.owner);
    const watched = await session(s);

    const res = await send('post', s.stop, s.costel, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      peakViewers: 2,
      viewedByDriverAt: watched.viewedByDriverAt?.toISOString(),
    });
  });

  it('says nobody watched a stream nobody opened, and stops it as usual', async () => {
    const s = await live();

    const res = await send('post', s.stop, s.costel, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ peakViewers: 0, viewedByDriverAt: null });
    expect(await kinds(s)).toEqual(['live.stopped', 'media.added']);
    expect(await session(s)).toMatchObject({
      peakViewers: 0,
      stopReason: 'sender',
      viewedByDriverAt: null,
    });
  });

  it('carries neither figure on a refused stop', async () => {
    const s = await live();
    await send('post', s.stop, s.costel, {});

    const res = await send('post', s.stop, s.costel, {});

    expect(res.status).toBe(409);
    expect(res.body.peakViewers).toBeUndefined();
    expect(res.body.viewedByDriverAt).toBeUndefined();
  });
});

// @traces 1251-FR-005 1251-FR-009
describe('stopping a live stream and discarding its recording', () => {
  it('registers nothing and deletes the recording once, after the stop', async () => {
    const s = await live();
    const before = await recordings('discarded');

    const res = await send('post', s.stop, s.owner, { keep: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      keep: false,
      liveSessionId: s.id,
      recordingMediaId: null,
    });
    expect(await prisma.mediaItem.count({ where: { jobId: s.job.id } })).toBe(
      0,
    );
    expect(await kinds(s)).toEqual(['live.stopped']);
    const [stop] = await prisma.outboxEvent.findMany({
      where: { kind: 'live.stopped', subjectId: s.job.id },
    });
    expect(stop?.payload).toMatchObject({ keep: false, reason: 'sender' });
    expect(fake().deleted).toEqual([s.inputId]);
    expect(await recordings('discarded')).toBe(before + 1);
  });

  it('still answers when the provider delete fails, logging ids alone', async () => {
    const s = await live();
    const warn = jest.mocked(Logger.prototype.warn);
    jest
      .spyOn(fake(), 'deleteRecording')
      .mockRejectedValueOnce(new Error('provider down secret-detail'));
    const before = await recordings('discard_failed');

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ keep: false, recordingMediaId: null });
    expect(warn).toHaveBeenCalledWith(
      `live recording not discarded: session ${s.id} input ${s.inputId} Error`,
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-detail');
    expect(await recordings('discard_failed')).toBe(before + 1);
  });

  it('gives up on a provider that never answers and still answers', async () => {
    const s = await live();
    jest
      .spyOn(fake(), 'deleteRecording')
      .mockReturnValueOnce(new Promise<void>(() => undefined));
    const before = await recordings('discard_failed');
    const sent = Date.now();

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.status).toBe(200);
    expect(Date.now() - sent).toBeLessThan(8000);
    expect(await recordings('discard_failed')).toBe(before + 1);
  }, 15_000);
});

// @traces 1251-FR-004
describe('changing the keep choice while live', () => {
  it.each([
    ['the job’s mechanic', 'costel'],
    ['the garage’s owner', 'owner'],
  ] as const)('lets %s change it once, audited', async (_who, key) => {
    const s = await live();

    const res = await send('patch', s.recording, s[key], { keep: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ keep: false });
    expect((await session(s)).keepRecording).toBe(false);
    expect(await keepEntries(s)).toEqual([
      expect.objectContaining({
        action: 'update',
        garageId: s.dinamo.garage.id,
        jobId: s.job.id,
        newValue: false,
        oldValue: true,
      }),
    ]);
    expect(await kinds(s)).toEqual([]);
  });

  it('writes nothing when the value does not change', async () => {
    const s = await live();

    const res = await send('patch', s.recording, s.costel, { keep: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ keep: true });
    expect(await keepEntries(s)).toEqual([]);
  });

  it('refuses a keep that is not a boolean', async () => {
    const s = await live();

    const res = await send('patch', s.recording, s.costel, { keep: 'no' });

    expect(res.status).toBe(400);
    await untouched(s);
  });
});

// @traces 1251-FR-006 1251-FR-010
describe('a stop or keep change that is refused', () => {
  const routes = (s: Live) =>
    [
      ['post', s.stop, { keep: false }],
      ['patch', s.recording, { keep: false }],
    ] as const;

  it('answers 404 to everyone without the right, and writes nothing', async () => {
    const s = await live();
    const admin = await world.account('Ana Admin', ['admin']);
    const ion = await world.account('Ion Pop', ['driver']);
    const callers = [
      bearer(s.andrei, 'driver'),
      bearer(ion, 'driver'),
      bearer(s.dinamo.receptionist, 'receptionist'),
      bearer(s.dinamo.answering, 'mechanic'),
      bearer(s.militari.owner, 'garage'),
      bearer(s.militari.plain, 'mechanic'),
      bearer(admin, 'admin'),
    ];

    for (const [method, path, body] of routes(s))
      for (const auth of callers)
        expect((await send(method, path, auth, body)).status).toBe(404);
    for (const path of [
      `/live-sessions/${randomUUID()}/stop`,
      `/live-sessions/${randomUUID()}/recording`,
    ])
      expect(
        (
          await send(path.endsWith('stop') ? 'post' : 'patch', path, s.owner, {
            keep: false,
          })
        ).status,
      ).toBe(404);
    await untouched(s);
  });

  it('answers 404 while the garage has live media off, before anything else', async () => {
    const s = await live();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    for (const [method, path, body] of routes(s))
      expect((await send(method, path, s.costel, body)).status).toBe(404);
    expect((await session(s)).stoppedAt).toBeNull();
    expect(fake().deleted).toEqual([]);
  });

  it('answers 409 live_ended once the stream has stopped', async () => {
    const s = await live();
    expect((await send('post', s.stop, s.costel, {})).status).toBe(200);
    const after = await session(s);
    fake().deleted.length = 0;

    for (const [method, path, body] of routes(s)) {
      const res = await send(method, path, s.owner, body);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'live_ended' });
    }
    expect(await session(s)).toEqual(after);
    expect(await keepEntries(s)).toEqual([]);
    expect(fake().deleted).toEqual([]);
  });

  it('lets one of two simultaneous stops through', async () => {
    const s = await live();

    const answers = await Promise.all([
      send('post', s.stop, s.costel, { keep: false }),
      send('post', s.stop, s.owner, { keep: false }),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(fake().deleted).toEqual([s.inputId]);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'live.stopped', subjectId: s.job.id },
      }),
    ).toBe(1);
  });

  it('answers 401 without a session', async () => {
    const s = await live();

    for (const [method, path, body] of routes(s)) {
      const res = await send(method, path, '', body);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'sign_in_required' });
    }
    await untouched(s);
  });

  it('logs a refused stop by code and session id alone', async () => {
    const s = await live();
    const warn = jest.mocked(Logger.prototype.warn);

    await send('post', s.stop, bearer(s.andrei, 'driver'), {});

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^live stop refused: \\w+ session ${s.id}$`),
      ),
    );
  });
});
