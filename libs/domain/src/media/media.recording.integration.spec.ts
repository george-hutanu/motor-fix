import { randomUUID } from 'node:crypto';

import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import { registerLiveRecording } from './media.recording';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { outbox } from '../events/event.port';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());
beforeEach(() => world.reset());

const deps = { audit: new AuditService(), events: outbox };
const DAY_MS = 24 * 60 * 60 * 1000;

async function closedJob() {
  const driver = await world.account('Andrei Marin', ['driver']);
  const dinamo = await world.garage('Atelier Dinamo');
  const { booking } = await world.chain(driver, dinamo.id);
  const job = await world.job(booking.id, 'in_work');
  return { driver, garageId: dinamo.id, job };
}

// @traces 1251-FR-003
describe('registering a kept live recording inside the stop', () => {
  it('writes a visible live item the provider holds, kept ninety days', async () => {
    const { garageId, job } = await closedJob();
    const providerRef = randomUUID();
    const sentAt = new Date('2026-10-29T10:00:00.000Z');

    const item = await prisma.$transaction((tx) =>
      registerLiveRecording(tx, deps, {
        garageId,
        jobId: job.id,
        providerRef,
        seconds: 754,
        sentAt,
      }),
    );

    expect(
      await prisma.mediaItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({
      contentType: 'video/mp4',
      fileKey: null,
      garageId,
      jobId: job.id,
      kind: 'live',
      originalKey: null,
      providerRef,
      purgeAfter: new Date(sentAt.getTime() + 90 * DAY_MS),
      seconds: 754,
      senderId: null,
      sentAt,
      sizeBytes: 0n,
      status: 'visible',
      uploadedAt: sentAt,
    });
  });

  it('announces the item to the job and audits it as the system', async () => {
    const { driver, garageId, job } = await closedJob();

    const item = await prisma.$transaction((tx) =>
      registerLiveRecording(tx, deps, {
        garageId,
        jobId: job.id,
        providerRef: randomUUID(),
        seconds: 12,
        sentAt: new Date(),
      }),
    );

    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'media.added', subjectId: job.id },
    });
    expect(events).toEqual([
      expect.objectContaining({
        payload: { jobId: job.id, kind: 'live', mediaId: item.id },
      }),
    ]);
    expect(events[0]?.audience).toEqual(
      expect.arrayContaining([`account:${driver}`, `garage:${garageId}`]),
    );
    expect(
      await prisma.activityLog.findMany({ where: { subjectId: item.id } }),
    ).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: null,
        actorRole: 'system',
        garageId,
        jobId: job.id,
        newValue: 'live',
        subjectType: 'media_item',
      }),
    ]);
  });

  it('counts nothing inside the transaction, so a rolled-back stop is never counted', async () => {
    const { garageId, job } = await closedJob();
    const labels = { kind: 'live', outcome: 'visible' };
    const before = await counterTotal(
      memory.metricReader,
      'motorfix_media_items_total',
      labels,
    );

    await expect(
      prisma.$transaction(async (tx) => {
        await registerLiveRecording(tx, deps, {
          garageId,
          jobId: job.id,
          providerRef: randomUUID(),
          seconds: 0,
          sentAt: new Date(),
        });
        throw new Error('stop failed');
      }),
    ).rejects.toThrow('stop failed');

    expect(
      await counterTotal(
        memory.metricReader,
        'motorfix_media_items_total',
        labels,
      ),
    ).toBe(before);
  });

  it('writes nothing when the surrounding transaction rolls back', async () => {
    const { garageId, job } = await closedJob();

    await expect(
      prisma.$transaction(async (tx) => {
        await registerLiveRecording(tx, deps, {
          garageId,
          jobId: job.id,
          providerRef: randomUUID(),
          seconds: 5,
          sentAt: new Date(),
        });
        throw new Error('stop failed');
      }),
    ).rejects.toThrow('stop failed');

    expect(await prisma.mediaItem.count({ where: { jobId: job.id } })).toBe(0);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'media.added', subjectId: job.id },
      }),
    ).toBe(0);
  });
});
