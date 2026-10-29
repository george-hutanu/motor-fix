import { randomUUID } from 'node:crypto';

import type { StorageEnv } from '@motor-fix/contracts';

import { purgeMedia } from './purge';
import type { MediaRetentionDeps } from './retention';
import { AuditService } from '../../audit/audit.service';
import type { MediaStatus } from '../../generated/prisma/enums';
import { FakeLiveVideo } from '../../live-video/providers/fake-live-video.provider';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';

const store = new S3TestStore();
const env = {} as StorageEnv;
beforeAll(async () => {
  await store.start();
  Object.assign(env, store.env());
});
afterAll(() => store.stop());

const { provider, team, world } = quotesApp([StorageModule.register(env)]);
const { prisma } = world;

const NOW = new Date('2026-10-29T01:00:00Z');
const DAY = 86_400_000;
const past = new Date(NOW.getTime() - DAY);
const future = new Date(NOW.getTime() + DAY);

let fake: FakeLiveVideo;
let logger: { log: jest.Mock; error: jest.Mock };

beforeEach(() => {
  store.objects.clear();
  fake = new FakeLiveVideo();
  logger = { error: jest.fn(), log: jest.fn() };
});
afterEach(() => jest.restoreAllMocks());

const deps = (): MediaRetentionDeps => ({
  audit: new AuditService(),
  logger,
  prisma,
  provider: fake,
  storage: provider(StorageService),
});

async function job() {
  const driver = await world.account('Andrei Marin', ['driver']);
  const garage = await team(`Atelier ${randomUUID().slice(0, 6)}`);
  const made = await world.job(
    (await world.chain(driver, garage.garage.id)).booking.id,
    'done',
  );
  return { garageId: garage.garage.id, id: made.id };
}

// An item with its three files in the store, or held by the provider.
async function item(
  j: { id: string; garageId: string },
  purgeAfter: Date,
  status: MediaStatus = 'visible',
  extra: Partial<{
    providerRef: string;
    uploadedAt: Date | null;
    sentAt: Date;
  }> = {},
) {
  const id = randomUUID();
  const original = `media_photo/${j.id}/${id}`;
  const keys = extra.providerRef
    ? []
    : [original, `${original}.display`, `${original}.thumb`];
  for (const key of keys) store.put(key, Buffer.from('x'), 'image/jpeg');
  await prisma.mediaItem.create({
    data: {
      contentType: 'image/jpeg',
      fileKey: keys[1] ?? null,
      garageId: j.garageId,
      id,
      jobId: j.id,
      kind: extra.providerRef ? 'live' : 'photo',
      originalKey: keys[0] ?? null,
      providerRef: extra.providerRef ?? null,
      purgeAfter,
      sentAt: extra.sentAt ?? new Date(purgeAfter.getTime() - 90 * DAY),
      sizeBytes: 1n,
      status,
      thumbnailKey: keys[2] ?? null,
      uploadedAt:
        extra.uploadedAt === undefined ? new Date() : extra.uploadedAt,
    },
  });
  return { id, keys };
}

const statusOf = async (id: string) =>
  (await prisma.mediaItem.findUniqueOrThrow({ where: { id } })).status;

// The audit log outlives each case's reset: read only these jobs' entries.
const purgeAudit = (...jobIds: string[]) =>
  prisma.activityLog.findMany({
    orderBy: { subjectId: 'asc' },
    where: { kind: 'media.purged', subjectId: { in: jobIds } },
  });

// @traces 333-FR-014 333-FR-001 333-FR-017
describe('the nightly media purge', () => {
  it('deletes every past item’s files, marks it purged and writes one audit entry per job', async () => {
    const first = await job();
    const second = await job();
    const a = await item(first, past);
    const b = await item(first, past, 'removed');
    const c = await item(second, past, 'failed');
    const kept = await item(second, future);

    expect(await purgeMedia(deps(), NOW)).toBe(3);

    for (const gone of [a, b, c]) {
      for (const key of gone.keys) expect(store.objects.has(key)).toBe(false);
      const row = await prisma.mediaItem.findUniqueOrThrow({
        where: { id: gone.id },
      });
      expect(row.status).toBe('purged');
      expect(row.purgedAt).toEqual(NOW);
    }
    expect(await statusOf(kept.id)).toBe('visible');
    for (const key of kept.keys) expect(store.objects.has(key)).toBe(true);
    const entries = await purgeAudit(first.id, second.id);
    expect(entries.map((e) => [e.subjectId, e.text]).sort()).toEqual(
      [
        [first.id, '2 fișiere șterse după 90 de zile'],
        [second.id, '1 fișier șters după 90 de zile'],
      ].sort(),
    );
    expect(entries[0]).toMatchObject({
      action: 'delete',
      actorId: null,
      actorRole: 'system',
      subjectType: 'job',
    });
  });

  it('deletes a provider-held recording at the provider', async () => {
    const j = await job();
    const rec = await item(j, past, 'visible', { providerRef: 'rec-5' });

    await purgeMedia(deps(), NOW);

    expect(fake.deleted).toEqual(['rec-5']);
    expect(await statusOf(rec.id)).toBe('purged');
  });

  it('changes nothing and writes no audit on a second run', async () => {
    const j = await job();
    await item(j, past);
    await purgeMedia(deps(), NOW);

    expect(await purgeMedia(deps(), NOW)).toBe(0);

    expect(await purgeAudit(j.id)).toHaveLength(1);
  });

  it('counts a file already missing as deleted', async () => {
    const j = await job();
    const it = await item(j, past);
    store.objects.delete(it.keys[0] as string);

    await purgeMedia(deps(), NOW);

    expect(await statusOf(it.id)).toBe('purged');
  });

  it('rolls back an item whose store delete fails, and tries it again the next night', async () => {
    const j = await job();
    const bad = await item(j, past);
    const good = await item(j, past);
    const storage = provider(StorageService);
    const real = storage.deleteWithCopies.bind(storage);
    jest
      .spyOn(storage, 'deleteWithCopies')
      .mockImplementation((key) =>
        key.endsWith(bad.id) ? Promise.reject(new Error('down')) : real(key),
      );

    expect(await purgeMedia(deps(), NOW)).toBe(1);

    expect(await statusOf(bad.id)).toBe('visible');
    expect(await statusOf(good.id)).toBe('purged');
    expect(logger.error).toHaveBeenCalledWith(
      `media ${bad.id} not purged: Error`,
    );
    jest.restoreAllMocks();

    expect(await purgeMedia(deps(), NOW)).toBe(1);
    expect(await statusOf(bad.id)).toBe('purged');
  });

  it('rolls back an item whose provider delete fails', async () => {
    const j = await job();
    const rec = await item(j, past, 'visible', { providerRef: 'rec-6' });
    jest.spyOn(fake, 'deleteRecording').mockRejectedValue(new Error('down'));

    expect(await purgeMedia(deps(), NOW)).toBe(0);

    expect(await statusOf(rec.id)).toBe('visible');
    expect(await purgeAudit(j.id)).toEqual([]);
  });

  it('deletes nothing twice when two runs overlap', async () => {
    const j = await job();
    for (let i = 0; i < 6; i += 1) await item(j, past);
    const storage = provider(StorageService);
    const deletes = jest.spyOn(storage, 'deleteWithCopies');

    const [one, two] = await Promise.all([
      purgeMedia(deps(), NOW),
      purgeMedia(deps(), NOW),
    ]);

    expect(one + two).toBe(6);
    expect(deletes).toHaveBeenCalledTimes(6);
  });

  it('fails an item never uploaded a day after it was asked for, and leaves one converting', async () => {
    const j = await job();
    const abandoned = await item(j, future, 'processing', {
      sentAt: new Date(NOW.getTime() - 25 * 3_600_000),
      uploadedAt: null,
    });
    const fresh = await item(j, future, 'processing', {
      sentAt: new Date(NOW.getTime() - 23 * 3_600_000),
      uploadedAt: null,
    });
    const converting = await item(j, future, 'processing', {
      sentAt: new Date(NOW.getTime() - 48 * 3_600_000),
      uploadedAt: new Date(NOW.getTime() - 3_600_000),
    });

    await purgeMedia(deps(), NOW);

    expect(await statusOf(abandoned.id)).toBe('failed');
    expect(await statusOf(fresh.id)).toBe('processing');
    expect(await statusOf(converting.id)).toBe('processing');
  });

  it('fails an item uploaded a day ago that is still converting', async () => {
    const j = await job();
    const stuck = await item(j, future, 'processing', {
      sentAt: new Date(NOW.getTime() - 26 * 3_600_000),
      uploadedAt: new Date(NOW.getTime() - 25 * 3_600_000),
    });

    await purgeMedia(deps(), NOW);

    expect(await statusOf(stuck.id)).toBe('failed');
  });

  it('keeps an item’s own date when the period changes', async () => {
    const j = await job();
    const old = await item(j, future);
    const saved = process.env['MEDIA_RETENTION_DAYS'];
    process.env['MEDIA_RETENTION_DAYS'] = '1';
    try {
      expect(await purgeMedia(deps(), NOW)).toBe(0);
    } finally {
      if (saved === undefined) delete process.env['MEDIA_RETENTION_DAYS'];
      else process.env['MEDIA_RETENTION_DAYS'] = saved;
    }
    expect(await statusOf(old.id)).toBe('visible');
  });
});
