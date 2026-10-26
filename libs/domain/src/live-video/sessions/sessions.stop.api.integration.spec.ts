import { AuditService } from '../../audit/audit.service';
import { noEvents, outbox } from '../../events/event.port';
import { GarageFeaturesService } from '../../garages/features/features.service';
import type { JobStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { moveJob } from '../../workshop/transitions';
import { LiveVideoModule } from '../live-video.module';

const { bearer, send, team, world } = quotesApp([
  LiveVideoModule.register({ provider: 'fake' }),
]);
const { prisma } = world;

// Costel live on Andrei's BMW at Atelier Dinamo.
async function live(status: JobStatus = 'in_work') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    status,
    { mechanicId: dinamo.plainMechanic.id },
  );
  const costel = bearer(dinamo.plain, 'mechanic');
  const started = await send('post', `/jobs/${job.id}/live`, costel);
  expect(started.status).toBe(201);
  return {
    andrei,
    costel,
    dinamo,
    id: started.body.liveSessionId as string,
    job,
  };
}

type Live = Awaited<ReturnType<typeof live>>;

const audit = new AuditService();

// cancel-booking moves its job with no events of its own.
const move = (s: Live, to: JobStatus, events = outbox) =>
  prisma.$transaction((tx) =>
    moveJob(
      tx,
      { audit, events },
      {
        actor: { accountId: s.dinamo.owner, role: 'garage' },
        event: {
          audience: {
            driverAccountId: s.andrei,
            garageId: s.dinamo.garage.id,
            mechanicId: s.dinamo.plainMechanic.id,
            type: 'job',
          },
          kind: to === 'done' ? 'job.done' : 'booking.cancelled',
        },
        id: s.job.id,
        to,
      },
    ),
  );

async function endedFor(s: Live, reason: string) {
  const row = await prisma.liveSession.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(row.stoppedAt).toBeInstanceOf(Date);
  expect(row.stopReason).toBe(reason);
  const stops = await prisma.outboxEvent.findMany({
    where: { kind: 'live.stopped', subjectId: s.job.id },
  });
  expect(stops).toHaveLength(1);
  const view = await send(
    'post',
    `/live-sessions/${s.id}/view-token`,
    bearer(s.andrei, 'driver'),
  );
  expect(view.status).toBe(409);
  expect(view.body).toMatchObject({ code: 'live_ended' });
}

// @traces 1250-FR-006
describe('the system ends a live stream', () => {
  it('when the job is done', async () => {
    const s = await live();

    await move(s, 'done');

    await endedFor(s, 'job_closed');
  });

  it('when the job is cancelled by a caller that writes no events', async () => {
    const s = await live('to_do');

    await move(s, 'cancelled', noEvents);

    await endedFor(s, 'job_closed');
  });

  it('when the garage switches live media off, and a new start works once it is back on', async () => {
    const s = await live();
    const features = new GarageFeaturesService(prisma, audit, outbox);
    const owner = garageActor(s.dinamo.owner, s.dinamo.garage.id);

    await features.set(owner, s.dinamo.garage.id, 'live_media', false);
    await features.set(owner, s.dinamo.garage.id, 'live_media', true);

    await endedFor(s, 'feature_off');
    const again = await send('post', `/jobs/${s.job.id}/live`, s.costel);
    expect(again.status).toBe(201);
    expect(again.body.liveSessionId).not.toBe(s.id);
  });
});
