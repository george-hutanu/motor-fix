import { LIVE_VIEW_TOKEN_TTL_MS } from '@motor-fix/contracts';

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

async function live() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'in_work',
    { mechanicId: dinamo.plainMechanic.id },
  );
  const costel = bearer(dinamo.plain, 'mechanic');
  const started = await send('post', `/jobs/${job.id}/live`, costel);
  expect(started.status).toBe(201);
  const id: string = started.body.liveSessionId;
  return {
    andrei,
    costel,
    dinamo,
    driver: bearer(andrei, 'driver'),
    id,
    owner: bearer(dinamo.owner, 'garage'),
    path: `/live-sessions/${id}/view-token`,
    stop: `/live-sessions/${id}/stop`,
  };
}

const row = (id: string) =>
  prisma.liveSession.findUniqueOrThrow({ where: { id } });
const viewers = (id: string) =>
  prisma.liveViewer.count({ where: { liveSessionId: id } });

// @traces 1252-FR-001 1252-FR-002 1252-FR-004
describe('what the stop answers about viewers', () => {
  it('answers zero and null when nobody watched', async () => {
    const s = await live();

    const res = await send('post', s.stop, s.owner, {});

    expect(res.status).toBe(200);
    expect(res.body.peakViewers).toBe(0);
    expect(res.body.viewedByDriverAt).toBeNull();
  });

  it('answers the peak and the driver’s first view as stored', async () => {
    const s = await live();
    await send('post', s.path, s.driver);
    await send('post', s.path, s.owner);

    const res = await send('post', s.stop, s.owner, {});

    const stored = await row(s.id);
    expect(res.body.peakViewers).toBe(2);
    expect(res.body.viewedByDriverAt).toBe(
      stored.viewedByDriverAt?.toISOString(),
    );
  });

  it('answers a null driver view when only the garage watched', async () => {
    const s = await live();
    await send('post', s.path, s.owner);
    await send('post', s.path, s.costel);

    const res = await send('post', s.stop, s.owner, {});

    expect(res.body.peakViewers).toBe(2);
    expect(res.body.viewedByDriverAt).toBeNull();
  });

  it('keeps the peak in the answer after a viewer’s account is deleted', async () => {
    const s = await live();
    await send('post', s.path, s.driver);
    const gone = await world.account('Ion Șters', ['driver']);
    await prisma.liveViewer.create({
      data: {
        accountId: gone,
        firstViewedAt: new Date(),
        lastViewedAt: new Date(),
        liveSessionId: s.id,
      },
    });
    await send('post', s.path, s.owner);
    await prisma.account.delete({ where: { id: gone } });

    const res = await send('post', s.stop, s.costel, {});

    expect(res.status).toBe(200);
    expect(res.body.peakViewers).toBe(3);
    expect(await prisma.liveViewer.count({ where: { accountId: gone } })).toBe(
      0,
    );
  });
});

// @traces 1252-FR-002 1252-FR-006
describe('who counts as the driver and when', () => {
  it('leaves the driver’s first view time alone on later views', async () => {
    const s = await live();
    await send('post', s.path, s.driver);
    const first = (await row(s.id)).viewedByDriverAt;
    expect(first).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 20));

    await send('post', s.path, s.driver);

    expect((await row(s.id)).viewedByDriverAt).toEqual(first);
  });

  it('keeps first_viewed_at and moves last_viewed_at on a repeat view', async () => {
    const s = await live();
    await send('post', s.path, s.owner);
    const before = await prisma.liveViewer.findFirstOrThrow({
      where: { liveSessionId: s.id },
    });
    await new Promise((r) => setTimeout(r, 20));

    await send('post', s.path, s.owner);

    const after = await prisma.liveViewer.findFirstOrThrow({
      where: { liveSessionId: s.id },
    });
    expect(after.firstViewedAt).toEqual(before.firstViewedAt);
    expect(after.lastViewedAt.getTime()).toBeGreaterThan(
      before.lastViewedAt.getTime(),
    );
  });

  it('does not mark the driver as having joined when the garage watches', async () => {
    const s = await live();

    await send('post', s.path, s.owner);
    await send('post', s.path, s.costel);

    expect((await row(s.id)).viewedByDriverAt).toBeNull();
  });
});

// @traces 1252-FR-001
describe('the five-minute window at its edge', () => {
  it('does not count a viewer whose credential expired exactly now', async () => {
    const s = await live();
    await send('post', s.path, s.owner);
    await prisma.liveViewer.updateMany({
      data: { lastViewedAt: new Date(Date.now() - LIVE_VIEW_TOKEN_TTL_MS) },
      where: { liveSessionId: s.id },
    });
    await prisma.liveSession.update({
      data: { peakViewers: 0 },
      where: { id: s.id },
    });

    await send('post', s.path, s.driver);

    expect((await row(s.id)).peakViewers).toBe(1);
  });

  it('keeps a recorded higher peak when the count drops below it', async () => {
    const s = await live();
    await prisma.liveSession.update({
      data: { peakViewers: 40 },
      where: { id: s.id },
    });

    await send('post', s.path, s.driver);

    expect((await row(s.id)).peakViewers).toBe(40);
  });
});

// @traces 1252-FR-002
describe('concurrent views by one account', () => {
  it('leaves one viewer row and a peak of one after ten simultaneous calls', async () => {
    const s = await live();

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => send('post', s.path, s.driver)),
    );

    expect(answers.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await viewers(s.id)).toBe(1);
    expect((await row(s.id)).peakViewers).toBe(1);
  });

  it('answers 409 and writes nothing to a view racing the stop', async () => {
    const s = await live();
    await send('post', s.path, s.driver);

    const [stop, ...views] = await Promise.all([
      send('post', s.stop, s.owner, {}),
      ...Array.from({ length: 5 }, () => send('post', s.path, s.owner)),
    ]);

    expect(stop.status).toBe(200);
    for (const v of views) expect([200, 409]).toContain(v.status);
    expect(stop.body.peakViewers).toBe((await row(s.id)).peakViewers);
    const okViews = views.filter((v) => v.status === 200).length;
    expect(await viewers(s.id)).toBe(okViews > 0 ? 2 : 1);
  });
});

// @traces 1252-FR-002 1252-FR-003
describe('refusals write nothing', () => {
  it('writes no viewer after the session has stopped', async () => {
    const s = await live();
    await send('post', s.stop, s.owner, {});

    const res = await send('post', s.path, s.driver);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'live_ended' });
    expect(await viewers(s.id)).toBe(0);
    const stored = await row(s.id);
    expect(stored.peakViewers).toBe(0);
    expect(stored.viewedByDriverAt).toBeNull();
  });

  it('writes nothing for a driver who does not own the job', async () => {
    const s = await live();
    const stranger = await world.account('Maria Ionescu', ['driver']);

    const res = await send('post', s.path, bearer(stranger, 'driver'));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
    expect(await viewers(s.id)).toBe(0);
    expect((await row(s.id)).peakViewers).toBe(0);
  });

  it('answers 400 for an id that is not a uuid and 404 for an unknown one', async () => {
    const s = await live();

    const bad = await send(
      'post',
      '/live-sessions/not-a-uuid/view-token',
      s.driver,
    );
    const unknown = await send(
      'post',
      '/live-sessions/00000000-0000-4000-8000-000000000000/view-token',
      s.driver,
    );

    expect(bad.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(await prisma.liveViewer.count()).toBe(0);
  });

  it('leaves the driver’s first view null when signing fails', async () => {
    const s = await live();
    const spy = jest
      .spyOn(provider<LiveVideoProvider>(LIVE_VIDEO_PROVIDER), 'viewUrl')
      .mockImplementation(() => {
        throw new Error('live video is not configured');
      });

    try {
      expect((await send('post', s.path, s.driver)).status).toBe(503);
    } finally {
      spy.mockRestore();
    }

    expect((await row(s.id)).viewedByDriverAt).toBeNull();
    expect(await viewers(s.id)).toBe(0);
  });

  it('keeps an earlier viewer and the peak when a later signing fails', async () => {
    const s = await live();
    await send('post', s.path, s.owner);
    const spy = jest
      .spyOn(provider<LiveVideoProvider>(LIVE_VIDEO_PROVIDER), 'viewUrl')
      .mockImplementation(() => {
        throw new Error('live video is not configured');
      });

    try {
      expect((await send('post', s.path, s.driver)).status).toBe(503);
    } finally {
      spy.mockRestore();
    }

    expect(await viewers(s.id)).toBe(1);
    expect((await row(s.id)).peakViewers).toBe(1);
  });
});
