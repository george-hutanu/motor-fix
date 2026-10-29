import { randomUUID } from 'node:crypto';

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

// Costel live on Andrei's BMW at Atelier Dinamo, and a second garage.
async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
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
    job,
    militari,
    owner: bearer(dinamo.owner, 'garage'),
    view: `/live-sessions/${id}/view-token`,
  };
}

const view = (path: string, auth: string) => send('post', path, auth);

async function writes() {
  return {
    audit: await prisma.activityLog.count(),
    events: await prisma.outboxEvent.count(),
    sessions: await prisma.liveSession.findMany(),
    viewers: await prisma.liveViewer.findMany(),
  };
}

const watched = (id: string) =>
  prisma.liveSession.findUniqueOrThrow({
    select: { peakViewers: true, viewedByDriverAt: true },
    where: { id },
  });

// @traces 1250-FR-003 1250-FR-011
describe('watching a live session', () => {
  it.each(['driver', 'owner', 'costel'] as const)(
    'gives the %s a five-minute low-latency view credential with no audit or event',
    async (key) => {
      const s = await setting();
      const before = await writes();
      const asked = Date.now();

      const res = await view(s.view, s[key]);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'url']);
      const expiresAt = Date.parse(res.body.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(asked + 300_000 - 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300_000 + 1000);
      const url = new URL(res.body.url);
      expect(url.pathname).toMatch(/\/manifest\/video\.m3u8$/);
      expect(url.searchParams.get('protocol')).toBe('llhls');
      expect(url.searchParams.get('exp')).toBe(
        String(Math.floor(expiresAt / 1000)),
      );
      const [row] = before.sessions;
      expect(url.pathname).toContain(row?.providerInputId);
      for (const personal of [s.andrei, s.dinamo.plain, s.job.id, 'Andrei'])
        expect(res.body.url).not.toContain(personal);
      const after = await writes();
      expect(after.audit).toBe(before.audit);
      expect(after.events).toBe(before.events);
    },
  );
});

// @traces 1252-FR-002 1252-FR-006
describe('who watched a live session', () => {
  it('records the driver’s first view on the session and his viewer row', async () => {
    const s = await setting();
    const asked = Date.now();

    const res = await view(s.view, s.driver);

    expect(res.status).toBe(200);
    const row = await watched(s.id);
    expect(row.viewedByDriverAt).toBeInstanceOf(Date);
    expect(row.viewedByDriverAt?.getTime()).toBeGreaterThanOrEqual(
      asked - 1000,
    );
    expect(row.viewedByDriverAt?.getTime()).toBeLessThanOrEqual(Date.now());
    const viewers = await prisma.liveViewer.findMany({
      where: { liveSessionId: s.id },
    });
    expect(viewers).toEqual([
      expect.objectContaining({
        accountId: s.andrei,
        firstViewedAt: row.viewedByDriverAt,
        lastViewedAt: row.viewedByDriverAt,
      }),
    ]);
    expect(Date.parse(res.body.expiresAt)).toBe(
      (row.viewedByDriverAt?.getTime() ?? 0) + 300_000,
    );
  });

  it('keeps the driver’s first view and moves only his last one on a renewal', async () => {
    const s = await setting();
    await view(s.view, s.driver);
    const first = await watched(s.id);

    expect((await view(s.view, s.driver)).status).toBe(200);

    const again = await watched(s.id);
    expect(again).toEqual(first);
    const [viewer] = await prisma.liveViewer.findMany({
      where: { liveSessionId: s.id },
    });
    expect(viewer?.firstViewedAt).toEqual(first.viewedByDriverAt);
    expect(viewer?.lastViewedAt.getTime()).toBeGreaterThanOrEqual(
      viewer?.firstViewedAt.getTime() ?? 0,
    );
    expect(await prisma.liveViewer.count()).toBe(1);
  });

  it.each(['owner', 'costel'] as const)(
    'records the %s as a viewer and leaves the driver’s first view empty',
    async (key) => {
      const s = await setting();

      expect((await view(s.view, s[key])).status).toBe(200);

      expect(await watched(s.id)).toEqual({
        peakViewers: 1,
        viewedByDriverAt: null,
      });
      expect(
        await prisma.liveViewer.findMany({ where: { liveSessionId: s.id } }),
      ).toEqual([
        expect.objectContaining({
          accountId: key === 'owner' ? s.dinamo.owner : s.dinamo.plain,
        }),
      ]);
    },
  );
});

async function nothingWatched(id: string) {
  const row = await watched(id);
  return (
    row.peakViewers === 0 &&
    row.viewedByDriverAt === null &&
    (await prisma.liveViewer.count()) === 0
  );
}

// @traces 1250-FR-004 1252-FR-002
describe('a view that is refused', () => {
  it('answers 404 to everyone without the right', async () => {
    const s = await setting();
    const stranger = await world.account('Dan Pop', ['driver']);
    const admin = await world.account('Ana Admin', ['admin']);
    const callers = [
      bearer(s.dinamo.receptionist, 'receptionist'),
      bearer(s.dinamo.answering, 'mechanic'),
      bearer(stranger, 'driver'),
      bearer(s.militari.owner, 'garage'),
      bearer(admin, 'admin'),
    ];

    for (const auth of callers)
      expect((await view(s.view, auth)).status).toBe(404);
    expect(
      (await view(`/live-sessions/${randomUUID()}/view-token`, s.owner)).status,
    ).toBe(404);
    expect(await nothingWatched(s.id)).toBe(true);
  });

  it('answers 409 live_ended once the session has stopped', async () => {
    const s = await setting();
    await prisma.liveSession.update({
      data: { stoppedAt: new Date(), stopReason: 'job_closed' },
      where: { id: s.id },
    });

    const res = await view(s.view, s.driver);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'live_ended' });
    expect(res.body.url).toBeUndefined();
    expect(await nothingWatched(s.id)).toBe(true);
  });

  it('answers 503 live_unavailable when the provider can no longer sign a link', async () => {
    const s = await setting();
    jest
      .spyOn(provider<LiveVideoProvider>(LIVE_VIDEO_PROVIDER), 'viewUrl')
      .mockImplementation(() => {
        throw new Error('live video is not configured');
      });

    const res = await view(s.view, s.driver);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'live_unavailable' });
    expect(res.body.url).toBeUndefined();
    expect(await nothingWatched(s.id)).toBe(true);
  });

  it('answers 404 before live_ended while the garage has live media off', async () => {
    const s = await setting();
    await prisma.liveSession.update({
      data: { stoppedAt: new Date(), stopReason: 'job_closed' },
      where: { id: s.id },
    });
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    expect((await view(s.view, s.driver)).status).toBe(404);
    expect((await view(s.view, s.owner)).status).toBe(404);
    expect(await nothingWatched(s.id)).toBe(true);
  });

  it('answers 401 without a session and 400 to a malformed id', async () => {
    const s = await setting();

    expect((await view(s.view, '')).status).toBe(401);
    expect(await nothingWatched(s.id)).toBe(true);
    expect((await view('/live-sessions/nope/view-token', s.owner)).status).toBe(
      400,
    );
  });
});
