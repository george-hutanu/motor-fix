import { LIVE_VIEW_TOKEN_TTL_MS } from '@motor-fix/contracts';

import * as metrics from './sessions.metrics';
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

// Costel live on Andrei's BMW at Atelier Dinamo; Andrei, the owner and
// Costel can each watch.
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
  };
}

const peak = async (id: string) =>
  (
    await prisma.liveSession.findUniqueOrThrow({
      select: { peakViewers: true },
      where: { id },
    })
  ).peakViewers;

// Moves an account's last credential back, as if it was taken that long ago.
const lastViewed = (id: string, accountId: string, msAgo: number) =>
  prisma.liveViewer.update({
    data: { lastViewedAt: new Date(Date.now() - msAgo) },
    where: { liveSessionId_accountId: { accountId, liveSessionId: id } },
  });

// @traces 1252-FR-001 1252-FR-002 1252-FR-006
describe('the most people watching a live session at once', () => {
  it('rises with each new viewer, one call at a time', async () => {
    const s = await live();
    expect(await peak(s.id)).toBe(0);

    const seen = [];
    for (const auth of [s.driver, s.owner, s.costel]) {
      expect((await send('post', s.path, auth)).status).toBe(200);
      seen.push(await peak(s.id));
    }

    expect(seen).toEqual([1, 2, 3]);
  });

  it('counts an account once however many players it opens', async () => {
    const s = await live();

    for (let i = 0; i < 3; i++)
      expect((await send('post', s.path, s.driver)).status).toBe(200);

    expect(await peak(s.id)).toBe(1);
    expect(
      await prisma.liveViewer.count({ where: { liveSessionId: s.id } }),
    ).toBe(1);
  });

  it('stops counting a viewer whose credential has expired, and never falls', async () => {
    const s = await live();
    for (const auth of [s.driver, s.owner, s.costel])
      await send('post', s.path, auth);
    expect(await peak(s.id)).toBe(3);
    await lastViewed(s.id, s.dinamo.owner, LIVE_VIEW_TOKEN_TTL_MS + 1);
    await lastViewed(s.id, s.dinamo.plain, LIVE_VIEW_TOKEN_TTL_MS + 1);

    expect((await send('post', s.path, s.driver)).status).toBe(200);
    expect(await peak(s.id)).toBe(3);

    await prisma.liveSession.update({
      data: { peakViewers: 0 },
      where: { id: s.id },
    });
    expect((await send('post', s.path, s.driver)).status).toBe(200);
    expect(await peak(s.id)).toBe(1);
  });

  it('still counts a viewer whose credential has a moment left', async () => {
    const s = await live();
    await send('post', s.path, s.owner);
    await lastViewed(s.id, s.dinamo.owner, LIVE_VIEW_TOKEN_TTL_MS - 5_000);

    await send('post', s.path, s.driver);

    expect(await peak(s.id)).toBe(2);
  });

  it('counts three viewers who arrive at the same moment', async () => {
    const s = await live();

    const answers = await Promise.all(
      [s.driver, s.owner, s.costel].map((auth) => send('post', s.path, auth)),
    );

    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await peak(s.id)).toBe(3);
    expect(
      await prisma.liveViewer.count({ where: { liveSessionId: s.id } }),
    ).toBe(3);
  });

  it('forgets a deleted account’s views and keeps the session’s figures', async () => {
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

    await prisma.account.delete({ where: { id: gone } });

    expect(
      await prisma.liveViewer.findMany({ where: { liveSessionId: s.id } }),
    ).toEqual([expect.objectContaining({ accountId: s.andrei })]);
    const row = await prisma.liveSession.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(row.peakViewers).toBe(1);
    expect(row.viewedByDriverAt).toBeInstanceOf(Date);
  });

  it('forgets the viewers with their session', async () => {
    const s = await live();
    await send('post', s.path, s.driver);

    await prisma.liveSession.delete({ where: { id: s.id } });

    expect(await prisma.liveViewer.count()).toBe(0);
  });
});

// @traces 1252-FR-005
describe('counting the views that record a viewer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts each recorded view once as issued, on the existing counter', async () => {
    const s = await live();
    const counted = jest.spyOn(metrics, 'countViewToken');

    await send('post', s.path, s.driver);
    await send('post', s.path, s.owner);

    expect(counted.mock.calls).toEqual([['issued'], ['issued']]);
  });

  it('counts a view the provider could not sign as unavailable, with no viewer kept', async () => {
    const s = await live();
    const counted = jest.spyOn(metrics, 'countViewToken');
    jest
      .spyOn(provider<LiveVideoProvider>(LIVE_VIDEO_PROVIDER), 'viewUrl')
      .mockImplementation(() => {
        throw new Error('live video is not configured');
      });

    expect((await send('post', s.path, s.driver)).status).toBe(503);

    expect(counted.mock.calls).toEqual([['unavailable']]);
    expect(await prisma.liveViewer.count()).toBe(0);
    expect(await peak(s.id)).toBe(0);
  });
});
