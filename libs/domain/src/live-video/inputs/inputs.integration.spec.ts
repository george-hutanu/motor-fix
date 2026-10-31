import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { LIVE_INPUTS_CONSUMER, LiveInputs } from './inputs';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';
import { FakeLiveVideo } from '../providers/fake-live-video.provider';
import {
  LIVE_RECORDINGS_CONSUMER,
  LiveRecordings,
  type LiveStoppedJob,
} from '../recordings/recordings';
import { stopLiveSessions } from '../stop-sessions';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());
beforeEach(() => world.reset());

const logger = new Logger('LiveInputs');
let provider: FakeLiveVideo;
beforeEach(() => {
  provider = new FakeLiveVideo();
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// Costel live on Andrei's job at Atelier Dinamo, recording discarded.
async function live() {
  const driver = await world.account('Andrei Marin', ['driver']);
  const dinamo = await world.garage('Atelier Dinamo');
  const { booking } = await world.chain(driver, dinamo.id);
  const job = await world.job(booking.id, 'in_work');
  const session = await prisma.liveSession.create({
    data: {
      garageId: dinamo.id,
      jobId: job.id,
      keepRecording: false,
      provider: 'fake',
      providerInputId: randomUUID(),
    },
  });
  return { job, session };
}

// The committed live.stopped row as the outbox relay hands it to a queue.
async function relayed(
  jobId: string,
  attempts: number | undefined,
): Promise<LiveStoppedJob> {
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'live.stopped', subjectId: jobId },
  });
  return {
    attemptsMade: 0,
    data: {
      id: String(event.id),
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
      subjectId: jobId,
    },
    opts: { attempts },
  };
}

// @traces 1390-FR-001 1390-FR-004 1390-FR-005
describe('closing the input of a session the system stopped', () => {
  it('closes the stopped session’s input once its stop committed, and the recording job still deletes by that input', async () => {
    const { job, session } = await live();
    await prisma.$transaction((tx) =>
      stopLiveSessions(tx, new AuditService(), { jobId: job.id }, 'job_closed'),
    );

    await new LiveInputs(prisma, provider, logger).onEvent(
      await relayed(job.id, LIVE_INPUTS_CONSUMER.jobs.attempts),
    );
    await new LiveRecordings(prisma, provider, logger).onEvent(
      await relayed(job.id, LIVE_RECORDINGS_CONSUMER.jobs.attempts),
    );

    expect(provider.closed).toEqual([session.providerInputId]);
    expect(provider.deleted).toEqual([session.providerInputId]);
  });
});
