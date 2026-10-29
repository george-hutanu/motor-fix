import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StorageEnv } from '@motor-fix/contracts';
import { type FactoryProvider, Logger } from '@nestjs/common';
import { UnrecoverableError, type Worker } from 'bullmq';
import sharp from 'sharp';

import { MediaProcessingModule } from './processing.module';
import { type ProcessingDeps, processMedia } from './processing.worker';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { LiveVideoModule } from '../../live-video/live-video.module';
import { redisUrlFor } from '../../notifications/notifications.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { MediaModule } from '../media.module';

const store = new S3TestStore();
const env = {} as StorageEnv;
beforeAll(async () => {
  await store.start();
  Object.assign(env, store.env());
});
afterAll(() => store.stop());

// Its own Redis database: the worker built here never takes another
// spec's jobs.
const redisUrl = redisUrlFor(8);
const { provider, team, world } = quotesApp([
  StorageModule.register(env),
  MediaModule.register({
    live: LiveVideoModule.register({ provider: 'fake' }),
    redisUrl,
  }),
]);
const { prisma } = world;

const work = mkdtempSync(join(tmpdir(), 'media-processing-'));
afterAll(() => rmSync(work, { force: true, recursive: true }));

// A short test pattern drawn by ffmpeg; no video file in the repository.
function clipOf(seconds: number): Buffer {
  const out = join(work, `${randomUUID()}.mp4`);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=160x120:rate=10:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    out,
  ]);
  return readFileSync(out);
}

const deps = (): ProcessingDeps => ({
  audit: provider<AuditPort>(AUDIT_PORT),
  events: provider<EventPort>(EVENT_PORT),
  prisma,
  storage: provider(StorageService),
});

beforeEach(() => store.objects.clear());

// An uploaded item waiting for the worker, its original in the store.
async function waiting(
  kind: 'photo' | 'clip' | 'live',
  original: Buffer,
  sender: 'mechanic' | 'owner' = 'mechanic',
) {
  const driver = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const job = await world.job(
    (await world.chain(driver, dinamo.garage.id)).booking.id,
    'in_work',
    { mechanicId: dinamo.plainMechanic.id },
  );
  const id = randomUUID();
  const originalKey = `media_${kind}/${job.id}/${id}`;
  store.put(
    originalKey,
    original,
    kind === 'photo' ? 'image/jpeg' : 'video/mp4',
  );
  const item = await prisma.mediaItem.create({
    data: {
      contentType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
      garageId: dinamo.garage.id,
      id,
      jobId: job.id,
      kind,
      originalKey,
      purgeAfter: new Date(Date.now() + 90 * 86_400_000),
      seconds: kind === 'clip' ? 45 : null,
      senderId:
        kind === 'live' ? null : dinamo[sender === 'owner' ? 'owner' : 'plain'],
      sentAt: new Date(),
      sizeBytes: BigInt(original.length),
      uploadedAt: new Date(),
    },
  });
  return { dinamo, item, job };
}

const eventsOf = (jobId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'media.added', subjectId: jobId },
  });

const auditOf = (subjectId: string) =>
  prisma.activityLog.findMany({
    where: { subjectId, subjectType: 'media_item' },
  });

const reread = (id: string) =>
  prisma.mediaItem.findUniqueOrThrow({ where: { id } });

// @traces 333-FR-006 333-FR-008
describe('converting a photo', () => {
  it('shows it with its file and thumbnail, one event and one audit entry', async () => {
    const photo = await sharp({
      create: { background: '#3a6', channels: 3, height: 3000, width: 4000 },
    })
      .jpeg()
      .toBuffer();
    const { dinamo, item, job } = await waiting('photo', photo);

    await processMedia(deps(), item.id);

    const shown = await reread(item.id);
    expect(shown).toMatchObject({
      fileKey: `${item.originalKey}.display`,
      status: 'visible',
      thumbnailKey: `${item.originalKey}.thumb`,
    });
    const file = store.objects.get(shown.fileKey as string);
    const size = await sharp(file?.body).metadata();
    expect(Math.max(size.width ?? 0, size.height ?? 0)).toBe(2048);
    expect(store.objects.has(item.originalKey as string)).toBe(true);
    const [event, ...more] = await eventsOf(job.id);
    expect(more).toEqual([]);
    expect(event?.payload).toEqual({
      jobId: job.id,
      kind: 'photo',
      mediaId: item.id,
    });
    expect(event?.audience).toEqual(
      expect.arrayContaining([
        `garage:${dinamo.garage.id}`,
        `mechanic:${dinamo.plainMechanic.id}`,
      ]),
    );
    const [entry, ...others] = await auditOf(item.id);
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      action: 'create',
      actorId: dinamo.plain,
      actorRole: 'mechanic',
      jobId: job.id,
      kind: 'media.added',
    });
  });

  it('records the garage owner as the sender’s role', async () => {
    const photo = await sharp({
      create: { background: '#36a', channels: 3, height: 50, width: 50 },
    })
      .png()
      .toBuffer();
    const { item } = await waiting('photo', photo, 'owner');

    await processMedia(deps(), item.id);

    const [entry] = await auditOf(item.id);
    expect(entry?.actorRole).toBe('owner');
  });

  it('changes nothing on a second run once shown', async () => {
    const photo = await sharp({
      create: { background: '#a63', channels: 3, height: 50, width: 50 },
    })
      .jpeg()
      .toBuffer();
    const { item, job } = await waiting('photo', photo);
    await processMedia(deps(), item.id);

    await processMedia(deps(), item.id);

    expect(await eventsOf(job.id)).toHaveLength(1);
    expect(await auditOf(item.id)).toHaveLength(1);
  });

  it('leaves a removed item alone', async () => {
    const photo = await sharp({
      create: { background: '#a63', channels: 3, height: 50, width: 50 },
    })
      .jpeg()
      .toBuffer();
    const { item, job } = await waiting('photo', photo);
    await prisma.mediaItem.update({
      data: { status: 'removed' },
      where: { id: item.id },
    });

    await processMedia(deps(), item.id);

    expect((await reread(item.id)).status).toBe('removed');
    expect(await eventsOf(job.id)).toEqual([]);
  });

  it('rejects a truncated photo, nothing shown and the original kept', async () => {
    const photo = await sharp({
      create: { background: '#a63', channels: 3, height: 400, width: 400 },
    })
      .jpeg()
      .toBuffer();
    const { item, job } = await waiting('photo', photo.subarray(0, 200));

    await expect(processMedia(deps(), item.id)).rejects.toThrow();

    expect((await reread(item.id)).status).toBe('processing');
    expect(store.objects.has(item.originalKey as string)).toBe(true);
    expect(await eventsOf(job.id)).toEqual([]);
  });
});

// @traces 333-FR-007 333-FR-008 333-FR-011
describe('converting a clip', () => {
  it('shows it with the seconds measured', async () => {
    const { item } = await waiting('clip', clipOf(3));

    await processMedia(deps(), item.id);

    const shown = await reread(item.id);
    expect(shown.status).toBe('visible');
    expect(shown.seconds).toBe(3);
    expect(store.objects.get(shown.fileKey as string)?.contentType).toBe(
      'video/mp4',
    );
  });

  it('refuses for good a clip that runs over 61 seconds, without a retry', async () => {
    const { item, job } = await waiting('clip', clipOf(63));

    await processMedia(deps(), item.id);

    expect((await reread(item.id)).status).toBe('failed');
    expect(await eventsOf(job.id)).toEqual([]);
  });

  it('converts a kept recording of any length', async () => {
    const { item, job } = await waiting('live', clipOf(63));

    await processMedia(deps(), item.id);

    expect((await reread(item.id)).seconds).toBe(63);
    const [entry] = await auditOf(item.id);
    expect(entry?.actorRole).toBe('system');
    expect(await eventsOf(job.id)).toHaveLength(1);
  });
});

// @traces 333-FR-007 333-FR-008
describe('a conversion that failed', () => {
  afterEach(() => jest.restoreAllMocks());

  async function worker() {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { providers = [] } = MediaProcessingModule.register({
      databaseUrl: process.env['DATABASE_URL'] ?? '',
      redisUrl,
    });
    const factory = providers.find(
      (p): p is FactoryProvider =>
        typeof p === 'object' &&
        'provide' in p &&
        typeof p.provide === 'symbol' &&
        p.provide.description === 'MEDIA_WORKER',
    );
    return (await factory?.useFactory(
      provider(StorageService),
      prisma,
    )) as Worker;
  }

  const job = (mediaId: string, attemptsMade: number) => ({
    attemptsMade,
    data: { mediaId },
    id: mediaId,
    name: 'convert',
    opts: { attempts: 2 },
  });

  async function settled(id: string) {
    for (let i = 0; i < 50; i += 1) {
      const item = await reread(id);
      if (item.status !== 'processing') return item;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return reread(id);
  }

  it('is retried once, then marked failed with no event and the original kept', async () => {
    const { item, job: work } = await waiting(
      'photo',
      Buffer.from('not a photo'),
    );
    const media = await worker();
    try {
      media.emit(
        'failed',
        job(item.id, 1) as never,
        new Error('bad'),
        'active',
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await reread(item.id)).status).toBe('processing');

      media.emit(
        'failed',
        job(item.id, 2) as never,
        new Error('bad'),
        'active',
      );

      expect((await settled(item.id)).status).toBe('failed');
      expect(await eventsOf(work.id)).toEqual([]);
      expect(store.objects.has(item.originalKey as string)).toBe(true);
    } finally {
      await media.close();
    }
  });

  it('fails an item at once on an error that cannot be retried', async () => {
    const { item } = await waiting('clip', Buffer.from('x'));
    const media = await worker();
    try {
      media.emit(
        'failed',
        job(item.id, 1) as never,
        new UnrecoverableError('broken'),
        'active',
      );

      expect((await settled(item.id)).status).toBe('failed');
    } finally {
      await media.close();
    }
  });
});
