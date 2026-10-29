import { randomUUID } from 'node:crypto';

import type { StorageEnv } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import sharp from 'sharp';

import { MediaModule } from './media.module';
import { MEDIA_JOBS, markVisible } from './media.service';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { JobStatus } from '../generated/prisma/enums';
import { LiveVideoModule } from '../live-video/live-video.module';
import { quotesApp } from '../quotes/quotes-api.testing';
import { S3TestStore } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';

// The store starts before the app reads its address.
const store = new S3TestStore();
const env = {} as StorageEnv;
beforeAll(async () => {
  await store.start();
  Object.assign(env, store.env());
});
afterAll(() => store.stop());

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const { bearer, get, provider, send, team, world } = quotesApp([
  StorageModule.register(env),
  MediaModule.register({
    live: LiveVideoModule.register({ provider: 'fake' }),
    redisUrl,
  }),
]);
const { prisma } = world;

const queue = new Queue('media', {
  connection: { maxRetriesPerRequest: null, url: redisUrl },
});
afterAll(() => queue.close());

const CHECKSUM = 'AAAAAA==';
const MB = 1024 * 1024;

beforeEach(() => {
  store.objects.clear();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const jpeg = () =>
  sharp({ create: { background: '#c33', channels: 3, height: 40, width: 60 } })
    .jpeg()
    .toBuffer();

// A BMW job at Atelier Dinamo in Costel's hands, Andrei's car, and a second
// garage.
async function setting(status: JobStatus = 'in_work') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const ioana = await world.account('Ioana Pop', ['driver']);
  const admin = await world.account('Admin', ['admin']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    status,
    { mechanicId: dinamo.plainMechanic.id },
  );
  return {
    admin: bearer(admin, 'admin'),
    andrei: bearer(andrei, 'driver'),
    costel: bearer(dinamo.plain, 'mechanic'),
    costelId: dinamo.plain,
    desk: bearer(dinamo.receptionist, 'receptionist'),
    dinamo,
    fixer: bearer(dinamo.answering, 'mechanic'),
    ioana: bearer(ioana, 'driver'),
    job,
    otherOwner: bearer(militari.owner, 'garage'),
    owner: bearer(dinamo.owner, 'garage'),
    ownerId: dinamo.owner,
    uploads: `/jobs/${job.id}/media/uploads`,
  };
}

type Setting = Awaited<ReturnType<typeof setting>>;

const photo = (extra: object = {}) => ({
  checksum: CHECKSUM,
  contentType: 'image/jpeg',
  kind: 'photo',
  sizeBytes: 2 * MB,
  ...extra,
});

const clip = (extra: object = {}) => ({
  checksum: CHECKSUM,
  contentType: 'video/mp4',
  kind: 'clip',
  seconds: 45,
  sizeBytes: 40 * MB,
  ...extra,
});

const ask = (s: Setting, auth: string, body: object = photo()) =>
  send('post', s.uploads, auth, body);

const complete = (id: string, auth: string) =>
  send('post', `/media/${id}/complete`, auth);

const items = (jobId: string) =>
  prisma.mediaItem.findMany({ orderBy: { sentAt: 'asc' }, where: { jobId } });

// An item the worker has shown, with its copies in the store.
async function shown(
  s: Setting,
  overrides: Partial<{
    status: 'visible' | 'removed' | 'processing' | 'failed' | 'purged';
    sentAt: Date;
    providerRef: string;
  }> = {},
) {
  const id = randomUUID();
  const original = `media_photo/${s.job.id}/${id}`;
  store.put(`${original}.display`, await jpeg(), 'image/jpeg');
  store.put(`${original}.thumb`, await jpeg(), 'image/jpeg');
  return prisma.mediaItem.create({
    data: {
      contentType: 'image/jpeg',
      fileKey: overrides.providerRef ? null : `${original}.display`,
      garageId: s.dinamo.garage.id,
      id,
      jobId: s.job.id,
      kind: overrides.providerRef ? 'live' : 'photo',
      originalKey: overrides.providerRef ? null : original,
      providerRef: overrides.providerRef ?? null,
      purgeAfter: new Date(Date.now() + 90 * 86_400_000),
      removedAt: overrides.status === 'removed' ? new Date() : null,
      senderId: overrides.providerRef ? null : s.costelId,
      sentAt: overrides.sentAt ?? new Date(),
      sizeBytes: 1000n,
      status: overrides.status ?? 'visible',
      thumbnailKey: overrides.providerRef ? null : `${original}.thumb`,
      uploadedAt: new Date(),
    },
  });
}

// @traces 333-FR-003 333-FR-015
describe('asking to send a photo or a clip', () => {
  it.each([
    ['the job’s mechanic', 'costel'],
    ['the garage owner', 'owner'],
  ] as const)(
    'gives %s a 15-minute upload address and a processing item',
    async (_who, key) => {
      const s = await setting();
      const before = Date.now();

      const res = await ask(s, s[key], photo({ caption: 'Plăcuțe uzate' }));

      expect(res.status).toBe(201);
      expect(res.body.item).toMatchObject({
        caption: 'Plăcuțe uzate',
        hasThumbnail: false,
        jobId: s.job.id,
        kind: 'photo',
        removedAt: null,
        seconds: null,
        status: 'processing',
      });
      const expires = Date.parse(res.body.upload.expiresAt);
      expect(expires - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
      expect(expires - before).toBeLessThanOrEqual(15 * 60_000 + 5000);
      expect(res.body.upload.key).toMatch(
        new RegExp(`^incoming/media_photo/${s.job.id}/`),
      );
      const [item] = await items(s.job.id);
      expect(item?.originalKey).toBe(res.body.upload.key);
      expect(item?.uploadedAt).toBeNull();
      const days =
        ((item?.purgeAfter.getTime() ?? 0) - (item?.sentAt.getTime() ?? 0)) /
        86_400_000;
      expect(days).toBe(90);
    },
  );

  it.each(['image/png', 'image/heic', 'image/webp'])(
    'takes a %s photo',
    async (contentType) => {
      const s = await setting();

      const res = await ask(s, s.costel, photo({ contentType }));

      expect(res.status).toBe(201);
    },
  );

  it.each([
    ['a photo over 10 MB', photo({ sizeBytes: 10 * MB + 1 }), 'file_too_large'],
    ['a GIF', photo({ contentType: 'image/gif' }), 'file_type_not_allowed'],
    ['a clip over 100 MB', clip({ sizeBytes: 100 * MB + 1 }), 'file_too_large'],
    [
      'an AVI clip',
      clip({ contentType: 'video/x-msvideo' }),
      'file_type_not_allowed',
    ],
    ['a clip declared over 60 seconds', clip({ seconds: 61 }), 'clip_too_long'],
  ])('refuses %s and creates nothing', async (_what, body, code) => {
    const s = await setting();

    const res = await ask(s, s.costel, body);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe(code);
    expect(await items(s.job.id)).toEqual([]);
  });

  it('answers in the caller’s language', async () => {
    const s = await setting();

    const res = await ask(s, s.costel, clip({ seconds: 90 }));

    expect(res.body.message).toBe('Un clip durează cel mult 60 de secunde');
  });

  it.each([
    ['seconds 0', clip({ seconds: 0 })],
    ['negative seconds', clip({ seconds: -5 })],
    ['seconds not whole', clip({ seconds: 2.5 })],
    ['a clip with no seconds', clip({ seconds: undefined })],
    ['a caption over 140 characters', photo({ caption: 'a'.repeat(141) })],
    ['no checksum', photo({ checksum: undefined })],
  ])('refuses %s as invalid', async (_what, body) => {
    const s = await setting();

    const res = await ask(s, s.costel, body);

    expect(res.status).toBe(400);
    expect(await items(s.job.id)).toEqual([]);
  });

  it('takes a clip of exactly 60 seconds with its declared length', async () => {
    const s = await setting();

    const res = await ask(s, s.costel, clip({ seconds: 60 }));

    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ kind: 'clip', seconds: 60 });
    expect(res.body.upload.key).toMatch(/^incoming\/media_clip\//);
  });

  it.each(['paused', 'done'] as const)(
    'takes media on a %s job not yet handed over',
    async (status) => {
      const s = await setting(status);

      expect((await ask(s, s.costel)).status).toBe(201);
    },
  );
});

// @traces 333-FR-004 333-FR-017
describe('who may send, and when', () => {
  it.each([
    ['a driver who is not the job’s', 'ioana', 404, 'not_found'],
    ['another garage’s owner', 'otherOwner', 404, 'not_found'],
    ['a MotorFix admin', 'admin', 404, 'not_found'],
    ['the garage’s receptionist', 'desk', 403, 'forbidden'],
    ['another mechanic of the garage', 'fixer', 403, 'forbidden'],
    ['the job’s driver', 'andrei', 403, 'forbidden'],
  ] as const)('refuses %s', async (_who, key, status, code) => {
    const s = await setting();

    const res = await ask(s, s[key]);

    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.code).toBe(code);
    expect(await items(s.job.id)).toEqual([]);
  });

  it('answers not_found for a job that does not exist', async () => {
    const s = await setting();

    const res = await send(
      'post',
      `/jobs/${randomUUID()}/media/uploads`,
      s.owner,
      photo(),
    );

    expect(res.status).toBe(404);
  });

  it('refuses a mechanic when the job has none, and takes the owner', async () => {
    const s = await setting();
    await prisma.job.update({
      data: { mechanicId: null },
      where: { id: s.job.id },
    });

    expect((await ask(s, s.costel)).status).toBe(403);
    expect((await ask(s, s.owner)).status).toBe(201);
  });

  it('hides the job when live media is off, and still lists what was sent', async () => {
    const s = await setting();
    const sent = await shown(s);
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });

    const res = await ask(s, s.costel);
    const list = await get(`/jobs/${s.job.id}/media`, s.andrei);
    const file = await get(`/media/${sent.id}/file`, s.andrei);

    expect(res.status).toBe(404);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([sent.id]);
    expect(file.status).toBe(200);
  });

  it('refuses a handed-over job', async () => {
    const s = await setting('done');
    await prisma.job.update({
      data: { handedOverAt: new Date() },
      where: { id: s.job.id },
    });

    const res = await ask(s, s.costel);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job_handed_over');
  });

  it.each(['to_do', 'cancelled'] as const)(
    'refuses a %s job',
    async (status) => {
      const s = await setting(status);

      const res = await ask(s, s.costel);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('job_not_in_work');
    },
  );

  it('checks the right before the switch, the switch before the state, and the state before the file', async () => {
    const s = await setting('to_do');
    await prisma.job.update({
      data: { handedOverAt: new Date() },
      where: { id: s.job.id },
    });

    expect((await ask(s, s.ioana, clip({ seconds: 61 }))).status).toBe(404);
    expect((await ask(s, s.desk, clip({ seconds: 61 }))).status).toBe(403);
    expect((await ask(s, s.owner, clip({ seconds: 61 }))).body.code).toBe(
      'job_handed_over',
    );
    await prisma.job.update({
      data: { handedOverAt: null },
      where: { id: s.job.id },
    });
    expect((await ask(s, s.owner, clip({ seconds: 61 }))).body.code).toBe(
      'job_not_in_work',
    );
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: s.dinamo.garage.id, key: 'live_media' },
    });
    expect((await ask(s, s.desk, clip({ seconds: 61 }))).status).toBe(403);
    expect((await ask(s, s.owner, clip({ seconds: 61 }))).status).toBe(404);
  });

  it('answers storage_unavailable and creates nothing when the address cannot be signed', async () => {
    const s = await setting();
    jest
      .spyOn(provider(StorageService), 'createUpload')
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await ask(s, s.costel);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('storage_unavailable');
    expect(await items(s.job.id)).toEqual([]);
  });
});

// @traces 333-FR-005
describe('completing an upload', () => {
  async function asked(s: Setting, body: object = photo()) {
    const res = await ask(s, s.costel, body);
    return {
      id: res.body.item.id as string,
      key: res.body.upload.key as string,
    };
  }

  it('confirms the file, stamps it and queues one conversion keyed by the item', async () => {
    const s = await setting();
    const { id, key } = await asked(s);
    store.put(key, await jpeg(), 'image/jpeg');

    const res = await complete(id, s.costel);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'processing' });
    const item = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });
    expect(item.uploadedAt).not.toBeNull();
    expect(item.originalKey).toBe(
      `media_photo/${s.job.id}/${key.split('/').pop()}`,
    );
    expect(store.objects.has(item.originalKey as string)).toBe(true);
    const job = await queue.getJob(id);
    expect(job?.data).toEqual({ mediaId: id });
    expect(job?.opts.attempts).toBe(2);
  });

  it('answers a second call the same and queues nothing more', async () => {
    const s = await setting();
    const { id, key } = await asked(s);
    store.put(key, await jpeg(), 'image/jpeg');
    await complete(id, s.costel);
    const first = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });

    const res = await complete(id, s.costel);

    expect(res.status).toBe(200);
    const again = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });
    expect(again.uploadedAt).toEqual(first.uploadedAt);
    const queued = await queue.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'active',
      'completed',
      'failed',
    ]);
    expect(queued.filter((job) => job.data.mediaId === id)).toHaveLength(1);
    const job = await queue.getJob(id);
    expect(job?.id).toBe(id);
  });

  it('queues an item again when the first call could not queue it', async () => {
    const s = await setting();
    const { id, key } = await asked(s);
    store.put(key, await jpeg(), 'image/jpeg');
    const spy = jest
      .spyOn(provider<Queue>(MEDIA_JOBS), 'add')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    expect((await complete(id, s.costel)).status).toBe(500);
    expect(await queue.getJob(id)).toBeUndefined();
    spy.mockRestore();

    const res = await complete(id, s.costel);

    expect(res.status).toBe(200);
    expect((await queue.getJob(id))?.data).toEqual({ mediaId: id });
  });

  it('answers file_missing while nothing was uploaded, and keeps the item processing', async () => {
    const s = await setting();
    const { id } = await asked(s);

    const res = await complete(id, s.costel);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('file_missing');
    const item = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });
    expect(item.status).toBe('processing');
    expect(item.uploadedAt).toBeNull();
  });

  it('fails an item whose bytes are not the JPEG declared, and deletes them', async () => {
    const s = await setting();
    const { id, key } = await asked(s);
    const mov = Buffer.concat([
      Buffer.from([0, 0, 0, 0x14]),
      Buffer.from('ftypqt  '),
      Buffer.alloc(64),
    ]);
    store.put(key, mov, 'image/jpeg');

    const res = await complete(id, s.costel);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('file_type_mismatch');
    expect(store.objects.has(key)).toBe(false);
    const item = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });
    expect(item.status).toBe('failed');
  });

  it('answers invalid_state for a failed item never uploaded', async () => {
    const s = await setting();
    const { id } = await asked(s);
    await prisma.mediaItem.update({
      data: { status: 'failed' },
      where: { id },
    });

    const res = await complete(id, s.costel);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_state');
  });

  it.each(['owner', 'andrei', 'fixer'] as const)(
    'hides the item from %s, who did not send it',
    async (key) => {
      const s = await setting();
      const { id } = await asked(s);

      expect((await complete(id, s[key])).status).toBe(404);
    },
  );
});

// @traces 333-FR-009
describe('listing a job’s media', () => {
  it('lists oldest first, the driver seeing only what is visible or removed', async () => {
    const s = await setting();
    const t = (m: number) => new Date(Date.UTC(2026, 9, 1, 10, m));
    const visible = await shown(s, { sentAt: t(1) });
    const processing = await shown(s, { sentAt: t(2), status: 'processing' });
    const removed = await shown(s, { sentAt: t(3), status: 'removed' });
    const failed = await shown(s, { sentAt: t(4), status: 'failed' });
    await shown(s, { sentAt: t(5), status: 'purged' });

    const driver = await get(`/jobs/${s.job.id}/media`, s.andrei);
    const owner = await get(`/jobs/${s.job.id}/media`, s.owner);
    const mechanic = await get(`/jobs/${s.job.id}/media`, s.costel);

    const ids = (res: typeof driver) =>
      res.body.items.map((i: { id: string }) => i.id);
    expect(ids(driver)).toEqual([visible.id, removed.id]);
    expect(ids(owner)).toEqual([
      visible.id,
      processing.id,
      removed.id,
      failed.id,
    ]);
    expect(ids(mechanic)).toEqual(ids(owner));
    expect(driver.body.items[0]).toEqual({
      caption: null,
      hasThumbnail: true,
      id: visible.id,
      jobId: s.job.id,
      kind: 'photo',
      removedAt: null,
      seconds: null,
      senderId: s.costelId,
      sentAt: t(1).toISOString(),
      status: 'visible',
    });
    expect(driver.body.items[1].removedAt).not.toBeNull();
  });

  it.each([
    ['another driver', 'ioana', 404],
    ['another garage’s owner', 'otherOwner', 404],
    ['a MotorFix admin', 'admin', 404],
    ['the receptionist', 'desk', 403],
    ['another mechanic of the garage', 'fixer', 403],
  ] as const)('refuses %s', async (_who, key, status) => {
    const s = await setting();

    expect((await get(`/jobs/${s.job.id}/media`, s[key])).status).toBe(status);
  });

  it('answers 401 without a session', async () => {
    const s = await setting();

    expect((await get(`/jobs/${s.job.id}/media`)).status).toBe(401);
  });
});

// @traces 333-FR-010
describe('the address of a file', () => {
  it.each(['andrei', 'owner', 'costel'] as const)(
    'gives %s a 5-minute address of the file or its thumbnail',
    async (key) => {
      const s = await setting();
      const item = await shown(s);
      const head = jest.spyOn(provider(StorageService), 'contentTypeOf');
      const before = Date.now();

      const file = await get(`/media/${item.id}/file`, s[key]);
      const thumb = await get(
        `/media/${item.id}/file?variant=thumbnail`,
        s[key],
      );

      expect(file.status).toBe(200);
      expect(file.body.url).toContain(
        encodeURIComponent(item.fileKey as string).replace(/%2F/g, '/'),
      );
      expect(thumb.body.url).toContain('.thumb');
      expect(Date.parse(file.body.expiresAt) - before).toBeLessThanOrEqual(
        5 * 60_000 + 5000,
      );
      expect(head).not.toHaveBeenCalled();
    },
  );

  it.each(['processing', 'failed', 'removed', 'purged'] as const)(
    'finds no file for a %s item',
    async (status) => {
      const s = await setting();
      const item = await shown(s, { status });

      expect((await get(`/media/${item.id}/file`, s.owner)).status).toBe(404);
    },
  );

  it('refuses a bad variant', async () => {
    const s = await setting();
    const item = await shown(s);

    expect(
      (await get(`/media/${item.id}/file?variant=original`, s.owner)).status,
    ).toBe(400);
  });

  it('gives the provider’s playback address of a recording it holds, and no thumbnail', async () => {
    const s = await setting();
    const item = await shown(s, { providerRef: 'rec-123' });

    const file = await get(`/media/${item.id}/file`, s.andrei);
    const thumb = await get(
      `/media/${item.id}/file?variant=thumbnail`,
      s.andrei,
    );

    expect(file.status).toBe(200);
    expect(file.body.url).toContain('rec-123');
    expect(thumb.status).toBe(404);
  });

  it.each([
    ['another driver', 'ioana', 404],
    ['the receptionist', 'desk', 403],
    ['another mechanic of the garage', 'fixer', 403],
  ] as const)('refuses %s', async (_who, key, status) => {
    const s = await setting();
    const item = await shown(s);

    expect((await get(`/media/${item.id}/file`, s[key])).status).toBe(status);
  });
});

// @traces 333-FR-004 333-FR-008
describe('a handover while an item converts', () => {
  it('still lets the item be shown', async () => {
    const s = await setting();
    const item = await shown(s, { status: 'processing' });
    await prisma.job.update({
      data: { handedOverAt: new Date(), status: 'done' },
      where: { id: s.job.id },
    });

    const deps = {
      audit: provider<AuditPort>(AUDIT_PORT),
      events: provider<EventPort>(EVENT_PORT),
      prisma,
    };
    expect(
      await markVisible(deps, item.id, {
        fileKey: item.fileKey,
        thumbnailKey: item.thumbnailKey,
      }),
    ).toBe(true);
    expect(
      await markVisible(deps, item.id, {
        fileKey: item.fileKey,
        thumbnailKey: item.thumbnailKey,
      }),
    ).toBe(false);
    const events = await prisma.outboxEvent.count({
      where: { kind: 'media.added', subjectId: s.job.id },
    });
    expect(events).toBe(1);
  });
});
