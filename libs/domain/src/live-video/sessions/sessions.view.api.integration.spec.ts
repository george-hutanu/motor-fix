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
  };
}

// @traces 1250-FR-003 1250-FR-011
describe('watching a live session', () => {
  it.each(['driver', 'owner', 'costel'] as const)(
    'gives the %s a five-minute low-latency view credential and writes nothing',
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
      expect(await writes()).toEqual(before);
    },
  );
});

// @traces 1250-FR-004
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
  });

  it('answers 401 without a session and 400 to a malformed id', async () => {
    const s = await setting();

    expect((await view(s.view, '')).status).toBe(401);
    expect((await view('/live-sessions/nope/view-token', s.owner)).status).toBe(
      400,
    );
  });
});
