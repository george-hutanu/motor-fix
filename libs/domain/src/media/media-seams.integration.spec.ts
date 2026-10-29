import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StorageEnv } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';
import { Queue } from 'bullmq';

import { MediaModule } from './media.module';
import { MediaService } from './media.service';
import { processMedia } from './processing/processing.worker';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { FakeLiveVideo } from '../live-video/providers/fake-live-video.provider';
import { LIVE_VIDEO_PROVIDER } from '../live-video/providers/live-video.provider';
import { redisUrlFor } from '../notifications/notifications.testing';
import { quotesApp } from '../quotes/quotes-api.testing';
import { S3TestStore } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';

const store = new S3TestStore();
const env = {} as StorageEnv;
beforeAll(async () => {
  await store.start();
  Object.assign(env, store.env());
});
afterAll(() => store.stop());

const redisUrl = redisUrlFor(0);
const { get, bearer, provider, team, world } = quotesApp([
  StorageModule.register(env),
  MediaModule.register({ liveVideo: { provider: 'fake' }, redisUrl }),
]);
const { prisma } = world;

const queue = new Queue('media', {
  connection: { maxRetriesPerRequest: null, url: redisUrl },
});
afterAll(() => queue.close());

const work = mkdtempSync(join(tmpdir(), 'media-seams-'));
afterAll(() => rmSync(work, { force: true, recursive: true }));

function recording(seconds: number): Buffer {
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

const media = () => provider(MediaService);
const fake = () => provider<FakeLiveVideo>(LIVE_VIDEO_PROVIDER);

beforeEach(() => {
  store.objects.clear();
  fake().deleted.length = 0;
});
afterEach(() => jest.restoreAllMocks());

// A handed-over job at a garage with live media switched off: a kept
// recording joins it all the same.
async function closedJob() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'done',
    { mechanicId: dinamo.plainMechanic.id },
  );
  await prisma.job.update({
    data: { handedOverAt: new Date() },
    where: { id: job.id },
  });
  await prisma.garageFeature.create({
    data: { enabled: false, garageId: dinamo.garage.id, key: 'live_media' },
  });
  const owner: Actor = { accountId: dinamo.owner, role: 'garage' } as Actor;
  return { andrei, dinamo, job, owner };
}

const events = (jobId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'media.added', subjectId: jobId },
  });
const audit = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId, subjectType: 'media_item' },
  });

// @traces 333-media-storage-FR-011
describe('a kept live recording', () => {
  it('held in storage, converts with no length limit and shows as the system’s', async () => {
    const { job } = await closedJob();
    const key = `media_live/${job.id}/${randomUUID()}`;
    store.put(key, recording(63), 'video/mp4');

    const dto = await media().registerRecording(job.id, { key }, 63);

    expect(dto).toMatchObject({
      kind: 'live',
      senderId: null,
      status: 'processing',
    });
    expect((await queue.getJob(dto.id))?.data).toEqual({ mediaId: dto.id });
    await processMedia(
      {
        audit: provider<AuditPort>(AUDIT_PORT),
        events: provider<EventPort>(EVENT_PORT),
        prisma,
        storage: provider(StorageService),
      },
      dto.id,
    );
    const item = await prisma.mediaItem.findUniqueOrThrow({
      where: { id: dto.id },
    });
    expect(item).toMatchObject({ seconds: 63, status: 'visible' });
    expect(await events(job.id)).toHaveLength(1);
    const [entry] = await audit(dto.id);
    expect(entry).toMatchObject({ action: 'create', actorRole: 'system' });
  });

  it('held by the provider, is visible at once and played from the provider', async () => {
    const { andrei, job } = await closedJob();

    const dto = await media().registerRecording(
      job.id,
      { providerRef: 'rec-77' },
      600,
    );

    expect(dto).toMatchObject({
      hasThumbnail: false,
      kind: 'live',
      status: 'visible',
    });
    const item = await prisma.mediaItem.findUniqueOrThrow({
      where: { id: dto.id },
    });
    expect(item.providerRef).toBe('rec-77');
    expect(item.originalKey).toBeNull();
    expect(await events(job.id)).toHaveLength(1);
    expect(await audit(dto.id)).toHaveLength(1);
    const file = await get(`/media/${dto.id}/file`, bearer(andrei, 'driver'));
    expect(file.status).toBe(200);
    expect(file.body.url).toContain('rec-77');
  });

  it('refuses a job that does not exist', async () => {
    await expect(
      media().registerRecording(randomUUID(), { providerRef: 'rec-1' }, 10),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

// @traces 333-media-storage-FR-012
describe('removing an item', () => {
  async function visible(providerRef?: string) {
    const s = await closedJob();
    if (providerRef) {
      const dto = await media().registerRecording(
        s.job.id,
        { providerRef },
        30,
      );
      return { ...s, id: dto.id, keys: [] as string[] };
    }
    const id = randomUUID();
    const original = `media_photo/${s.job.id}/${id}`;
    const keys = [original, `${original}.display`, `${original}.thumb`];
    for (const key of keys) store.put(key, Buffer.from('x'), 'image/jpeg');
    await prisma.mediaItem.create({
      data: {
        contentType: 'image/jpeg',
        fileKey: keys[1],
        garageId: s.dinamo.garage.id,
        id,
        jobId: s.job.id,
        kind: 'photo',
        originalKey: original,
        purgeAfter: new Date(Date.now() + 86_400_000),
        senderId: s.dinamo.plain,
        sentAt: new Date(),
        sizeBytes: 1n,
        status: 'visible',
        thumbnailKey: keys[2],
        uploadedAt: new Date(),
      },
    });
    return { ...s, id, keys };
  }

  it('deletes its three files, then marks it removed with one audit entry', async () => {
    const { id, keys, owner } = await visible();

    await media().removeItem(id, owner);

    for (const key of keys) expect(store.objects.has(key)).toBe(false);
    const item = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });
    expect(item.status).toBe('removed');
    expect(item.removedAt).not.toBeNull();
    const entries = await audit(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: owner.accountId,
      field: 'status',
      newValue: 'removed',
      oldValue: 'visible',
    });
  });

  it('deletes a provider-held recording at the provider', async () => {
    const { id, owner } = await visible('rec-9');

    await media().removeItem(id, owner);

    expect(fake().deleted).toEqual(['rec-9']);
    expect(
      (await prisma.mediaItem.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('removed');
  });

  it.each(['processing', 'failed', 'removed'] as const)(
    'refuses a %s item and changes nothing',
    async (status) => {
      const { id, keys, owner } = await visible();
      await prisma.mediaItem.update({ data: { status }, where: { id } });

      const error = await media()
        .removeItem(id, owner)
        .catch((e: HttpException) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'invalid_state',
      });
      for (const key of keys) expect(store.objects.has(key)).toBe(true);
      expect(await audit(id)).toEqual([]);
    },
  );

  it('stays visible with no audit entry when the store cannot delete', async () => {
    const { id, owner } = await visible();
    jest
      .spyOn(provider(StorageService), 'deleteWithCopies')
      .mockRejectedValue(new Error('store down'));

    await expect(media().removeItem(id, owner)).rejects.toThrow('store down');

    expect(
      (await prisma.mediaItem.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('visible');
    expect(await audit(id)).toEqual([]);
  });

  it('stays visible when the provider cannot delete', async () => {
    const { id, owner } = await visible('rec-10');
    const before = (await audit(id)).length;
    jest
      .spyOn(fake(), 'deleteRecording')
      .mockRejectedValue(new Error('provider down'));

    await expect(media().removeItem(id, owner)).rejects.toThrow(
      'provider down',
    );

    expect(
      (await prisma.mediaItem.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('visible');
    expect(await audit(id)).toHaveLength(before);
  });
});
