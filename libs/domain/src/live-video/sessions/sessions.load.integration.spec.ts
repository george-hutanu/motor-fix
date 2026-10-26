import { quotesApp } from '../../quotes/quotes-api.testing';
import { LiveVideoModule } from '../live-video.module';

const { bearer, send, team, world } = quotesApp([
  LiveVideoModule.register({ provider: 'fake' }),
]);
const { prisma } = world;

const GARAGES = 20;

// @traces 1250-FR-010
describe('live sessions under load', () => {
  it('starts twenty streams at once and hands out sixty view credentials with no server error', async () => {
    const jobs = [];
    for (let i = 0; i < GARAGES; i++) {
      const driver = await world.account(`Șofer ${i}`, ['driver']);
      const t = await team(`Atelier ${i}`);
      const job = await world.job(
        (await world.chain(driver, t.garage.id)).booking.id,
        'in_work',
        { mechanicId: t.plainMechanic.id },
      );
      jobs.push({ driver, job, t });
    }

    const starts = await Promise.all(
      jobs.map(({ job, t }) =>
        send('post', `/jobs/${job.id}/live`, bearer(t.plain, 'mechanic')),
      ),
    );

    expect(starts.map((r) => r.status)).toEqual(Array(GARAGES).fill(201));
    const views = await Promise.all(
      jobs.flatMap(({ driver, t }, i) => {
        const path = `/live-sessions/${starts[i]?.body.liveSessionId}/view-token`;
        return [
          bearer(driver, 'driver'),
          bearer(t.owner, 'garage'),
          bearer(t.plain, 'mechanic'),
        ].map((auth) => send('post', path, auth));
      }),
    );
    expect(views.map((r) => r.status)).toEqual(Array(GARAGES * 3).fill(200));
    expect(await prisma.liveSession.count({ where: { stoppedAt: null } })).toBe(
      GARAGES,
    );
  }, 60_000);
});
