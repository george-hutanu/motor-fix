import { AuditService } from '../../audit/audit.service';
import { noEvents, outbox } from '../../events/event.port';
import { GarageFeaturesService } from '../../garages/features/features.service';
import type { JobStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { moveJob } from '../../workshop/transitions';
import { LiveVideoModule } from '../live-video.module';
import type { FakeLiveVideo } from '../providers/fake-live-video.provider';
import { LIVE_VIDEO_PROVIDER } from '../providers/live-video.provider';

const { bearer, provider, send, team, world } = quotesApp([
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

const fake = () => provider<FakeLiveVideo>(LIVE_VIDEO_PROVIDER);

// @traces 1251-FR-007 1251-FR-010
describe('the system ends a live stream with the recording choice', () => {
  const ends = {
    cancelled: (s: Live) => move(s, 'cancelled', noEvents),
    done: (s: Live) => move(s, 'done'),
    switched_off: async (s: Live) => {
      const features = new GarageFeaturesService(prisma, audit, outbox);
      const owner = garageActor(s.dinamo.owner, s.dinamo.garage.id);
      await features.set(owner, s.dinamo.garage.id, 'live_media', false);
    },
  };

  it.each([
    ['done', true],
    ['done', false],
    ['cancelled', true],
    ['cancelled', false],
    ['switched_off', true],
    ['switched_off', false],
  ] as const)(
    'when %s keeps the recording only if the session says so (%s)',
    async (end, keepRecording) => {
      const s = await live(end === 'cancelled' ? 'to_do' : 'in_work');
      await prisma.liveSession.update({
        data: { keepRecording },
        where: { id: s.id },
      });
      fake().deleted.length = 0;

      await ends[end](s);

      const items = await prisma.mediaItem.findMany({
        where: { jobId: s.job.id },
      });
      expect(items).toEqual(
        keepRecording
          ? [expect.objectContaining({ kind: 'live', senderId: null })]
          : [],
      );
      const row = await prisma.liveSession.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(row.recordingMediaId).toBe(items[0]?.id ?? null);
      const [stop] = await prisma.outboxEvent.findMany({
        where: { kind: 'live.stopped', subjectId: s.job.id },
      });
      expect(stop?.payload).toMatchObject({ keep: keepRecording });
      expect(fake().deleted).toEqual([]);
    },
  );
});

// @traces 1251-FR-005 1251-FR-007
describe('a sender stop racing the system ending the stream', () => {
  const ends = {
    done: (s: Live) => move(s, 'done'),
    switched_off: (s: Live) =>
      new GarageFeaturesService(prisma, audit, outbox).set(
        garageActor(s.dinamo.owner, s.dinamo.garage.id),
        s.dinamo.garage.id,
        'live_media',
        false,
      ),
  };

  it.each(['done', 'switched_off'] as const)(
    'ends it once with one recording, neither side failing, when %s',
    async (end) => {
      for (let round = 0; round < 5; round++) {
        const s = await live();
        const [stopped] = await Promise.all([
          send('post', `/live-sessions/${s.id}/stop`, s.costel, { keep: true }),
          ends[end](s),
        ]);

        expect([200, 404, 409]).toContain(stopped.status);
        const stops = await prisma.outboxEvent.count({
          where: { kind: 'live.stopped', subjectId: s.job.id },
        });
        expect(stops).toBe(1);
        const items = await prisma.mediaItem.count({
          where: { jobId: s.job.id, kind: 'live' },
        });
        expect(items).toBe(1);
        if (end === 'switched_off')
          await new GarageFeaturesService(prisma, audit, outbox).set(
            garageActor(s.dinamo.owner, s.dinamo.garage.id),
            s.dinamo.garage.id,
            'live_media',
            true,
          );
      }
    },
    30_000,
  );
});
