import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { quotesApp } from '../../quotes/quotes-api.testing';
import { LiveVideoModule } from '../live-video.module';
import type { FakeLiveVideo } from '../providers/fake-live-video.provider';
import { LIVE_VIDEO_PROVIDER } from '../providers/live-video.provider';

const { bearer, provider, send, team, world } = quotesApp([
  LiveVideoModule.register({ provider: 'fake' }),
]);
const { prisma } = world;
const fake = () => provider<FakeLiveVideo>(LIVE_VIDEO_PROVIDER);

async function live() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
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
    costel,
    dinamo,
    id,
    inputId: row.providerInputId,
    job,
    owner: bearer(dinamo.owner, 'garage'),
    recording: `/live-sessions/${id}/recording`,
    stop: `/live-sessions/${id}/stop`,
  };
}
type Live = Awaited<ReturnType<typeof live>>;
const row = (s: Live) =>
  prisma.liveSession.findUniqueOrThrow({ where: { id: s.id } });
const keepEntries = (s: Live) =>
  prisma.activityLog.findMany({
    where: { field: 'keep_recording', subjectId: s.id },
  });

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  fake().deleted.length = 0;
});

// @traces 1251-FR-004 1251-FR-005
describe('malformed keep choices', () => {
  it.each([
    ['a string true', 'true'],
    ['the number one', 1],
    ['the number zero', 0],
    ['an empty string', ''],
    ['an array', [true]],
    ['an object', { keep: true }],
  ])('refuses %s on the patch and writes nothing', async (_n, keep) => {
    const s = await live();

    const res = await send('patch', s.recording, s.costel, { keep });

    expect(res.status).toBe(400);
    expect((await row(s)).keepRecording).toBe(true);
    expect(await keepEntries(s)).toEqual([]);
  });

  it.each([
    ['a string false', 'false'],
    ['the number zero', 0],
    ['null', null],
    ['an array', []],
  ])('refuses %s on the stop and leaves the stream live', async (_n, keep) => {
    const s = await live();

    const res = await send('post', s.stop, s.costel, { keep });

    expect(res.status).toBe(400);
    expect((await row(s)).stoppedAt).toBeNull();
    expect(fake().deleted).toEqual([]);
  });

  it('refuses a null keep on the patch', async () => {
    const s = await live();

    const res = await send('patch', s.recording, s.costel, { keep: null });

    expect(res.status).toBe(400);
  });

  it('refuses an empty patch body', async () => {
    const s = await live();

    const res = await send('patch', s.recording, s.costel, {});

    expect(res.status).toBe(400);
  });

  it('refuses an extra field on the patch and on the stop', async () => {
    const s = await live();

    const patch = await send('patch', s.recording, s.costel, {
      extra: 1,
      keep: false,
    });
    const stop = await send('post', s.stop, s.costel, {
      keep: false,
      stoppedAt: '2020-01-01T00:00:00Z',
    });

    expect(patch.status).toBe(400);
    expect(stop.status).toBe(400);
    expect(await row(s)).toMatchObject({
      keepRecording: true,
      stoppedAt: null,
    });
  });

  it.each([
    ['not-a-uuid'],
    ['1'],
    ['%F0%9F%90%98'],
    ['00000000-0000-0000-0000-00000000000'],
  ])('answers 400 to the id %s on both routes', async (id) => {
    const s = await live();

    const patch = await send(
      'patch',
      `/live-sessions/${id}/recording`,
      s.owner,
      {
        keep: false,
      },
    );
    const stop = await send('post', `/live-sessions/${id}/stop`, s.owner, {});

    expect(patch.status).toBe(400);
    expect(stop.status).toBe(400);
  });
});

// @traces 1251-FR-003 1251-FR-005
describe('the stop answer and what it registers', () => {
  it('registers a live item for the recording with the session’s window', async () => {
    const s = await live();
    await prisma.liveSession.update({
      data: { startedAt: new Date(Date.now() - 125_900) },
      where: { id: s.id },
    });

    const res = await send('post', s.stop, s.costel, { keep: true });

    expect(res.status).toBe(200);
    const stopped = await row(s);
    expect(res.body.stoppedAt).toBe(stopped.stoppedAt?.toISOString());
    expect(res.body.seconds).toBe(
      Math.floor(
        ((stopped.stoppedAt?.getTime() ?? 0) - stopped.startedAt.getTime()) /
          1000,
      ),
    );
    expect(res.body.seconds).toBeGreaterThanOrEqual(125);
    const item = await prisma.mediaItem.findUniqueOrThrow({
      where: { id: res.body.recordingMediaId },
    });
    expect(item).toMatchObject({
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      kind: 'live',
      providerRef: s.inputId,
      status: 'visible',
    });
    expect(stopped.recordingMediaId).toBe(item.id);
    expect(fake().deleted).toEqual([]);
  });

  it('never answers negative seconds when the clock reads before the start', async () => {
    const s = await live();
    await prisma.liveSession.update({
      data: { startedAt: new Date(Date.now() + 3_600_000) },
      where: { id: s.id },
    });

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.status).toBe(200);
    expect(res.body.seconds).toBeGreaterThanOrEqual(0);
  });

  it('writes live.stopped before media.added and no second media item on a retry', async () => {
    const s = await live();

    await send('post', s.stop, s.costel, { keep: true });
    const again = await send('post', s.stop, s.costel, { keep: true });

    expect(again.status).toBe(409);
    const events = await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: {
        kind: { in: ['live.stopped', 'media.added'] },
        subjectId: s.job.id,
      },
    });
    expect(events.map((e) => e.kind)).toEqual(['live.stopped', 'media.added']);
    expect(events[0]?.payload).toMatchObject({ keep: true, reason: 'sender' });
    expect(events[1]?.payload).toMatchObject({ jobId: s.job.id, kind: 'live' });
    expect(await prisma.mediaItem.count({ where: { jobId: s.job.id } })).toBe(
      1,
    );
  });

  it('keeps the recording when the patch said discard and the stop says keep', async () => {
    const s = await live();
    await send('patch', s.recording, s.costel, { keep: false });

    const res = await send('post', s.stop, s.costel, { keep: true });

    expect(res.body.keep).toBe(true);
    expect(res.body.recordingMediaId).not.toBeNull();
    expect(await keepEntries(s)).toHaveLength(2);
    expect(fake().deleted).toEqual([]);
  });

  it('audits a flip and flip back as two entries, and the same value twice as none', async () => {
    const s = await live();

    for (const keep of [false, false, true, true])
      expect((await send('patch', s.recording, s.owner, { keep })).status).toBe(
        200,
      );

    const entries = await keepEntries(s);
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual(
      expect.arrayContaining([
        [true, false],
        [false, true],
      ]),
    );
    expect(entries).toHaveLength(2);
  });
});

// @traces 1251-FR-005 1251-FR-009
describe('a provider that misbehaves on discard', () => {
  it('still stops and answers when the delete throws before returning a promise', async () => {
    const s = await live();
    jest.spyOn(fake(), 'deleteRecording').mockImplementationOnce(() => {
      throw new TypeError('sync boom');
    });

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.status).toBe(200);
    expect((await row(s)).stoppedAt).toBeInstanceOf(Date);
  });

  it('has committed the stop while a hung delete is still pending', async () => {
    const s = await live();
    jest
      .spyOn(fake(), 'deleteRecording')
      .mockReturnValueOnce(new Promise<void>(() => undefined));

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.status).toBe(200);
    expect((await row(s)).stopReason).toBe('sender');
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'live.stopped', subjectId: s.job.id },
      }),
    ).toBe(1);
  }, 15_000);
});

// @traces 1251-FR-006 1251-FR-010
describe('racing and refused calls', () => {
  it('lets one of twenty simultaneous stops through', async () => {
    const s = await live();

    const answers = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        send('post', s.stop, i % 2 ? s.costel : s.owner, { keep: false }),
      ),
    );

    expect(answers.filter((r) => r.status === 200)).toHaveLength(1);
    expect(answers.filter((r) => r.status === 409)).toHaveLength(19);
    expect(fake().deleted).toEqual([s.inputId]);
  });

  it('ends consistent when a patch races a stop that names no choice', async () => {
    const s = await live();

    const [patch, stop] = await Promise.all([
      send('patch', s.recording, s.owner, { keep: false }),
      send('post', s.stop, s.costel),
    ]);

    const final = await row(s);
    expect([200, 409]).toContain(patch.status);
    expect(stop.status).toBe(200);
    expect(stop.body.keep).toBe(final.keepRecording);
    expect(stop.body.recordingMediaId !== null).toBe(final.keepRecording);
    expect(fake().deleted.length).toBe(final.keepRecording ? 0 : 1);
  });

  it('answers 404 rather than 409 on a stopped session whose garage switched live media off', async () => {
    const s = await live();
    await send('post', s.stop, s.costel, {});
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    const patch = await send('patch', s.recording, s.costel, { keep: false });
    const stop = await send('post', s.stop, s.costel, {});

    expect(patch.status).toBe(404);
    expect(stop.status).toBe(404);
  });

  it('answers 409 live_ended on a stream the job closing already ended', async () => {
    const s = await live();
    await prisma.liveSession.update({
      data: { stoppedAt: new Date(), stopReason: 'job_closed' },
      where: { id: s.id },
    });

    const res = await send('post', s.stop, s.costel, { keep: false });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'live_ended' });
    expect(fake().deleted).toEqual([]);
  });

  it('answers 404 to an unknown session that is a valid uuid, for patch and stop alike', async () => {
    const s = await live();
    const id = randomUUID();

    const patch = await send(
      'patch',
      `/live-sessions/${id}/recording`,
      s.owner,
      {
        keep: true,
      },
    );
    const stop = await send('post', `/live-sessions/${id}/stop`, s.owner);

    expect([patch.status, stop.status]).toEqual([404, 404]);
  });
});
