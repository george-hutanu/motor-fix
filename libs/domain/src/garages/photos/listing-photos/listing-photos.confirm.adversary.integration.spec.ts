// @traces 1191-FR-003
import { crc32 } from 'node:zlib';

import { HttpException } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  LISTING_PHOTOS_QUEUE,
  ListingPhotosService,
} from './listing-photos.service';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../notifications/notifications.testing';
import type { RateLimits } from '../../../rate-limit/rate-limit.service';
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageService } from '../../../storage/storage.service';
import { ListingDraftsService } from '../../listing-drafts/listing-drafts.service';

// The limits are proven at the route; here every call is admitted.
const unlimited = { take: async () => undefined } as unknown as RateLimits;

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const checksumOf = (file: Buffer) => {
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(file));
  return sum.toString('base64');
};

const store = new S3TestStore();
const queue = new Queue(LISTING_PHOTOS_QUEUE, {
  connection: { url: redisUrlFor(13) },
});
const notifications = {
  sendToDraft: async () => undefined,
} as unknown as NotificationsService;
const drafts = new ListingDraftsService(prisma, notifications, {
  webUrl: 'https://motorfix.test',
} as never);
let storage: StorageService;
let photos: ListingPhotosService;

beforeAll(async () => {
  await store.start();
  storage = new StorageService(store.env());
  photos = new ListingPhotosService(prisma, drafts, storage, queue, unlimited);
});

afterAll(async () => {
  storage.onApplicationShutdown();
  await store.stop();
  await queue.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  store.objects.clear();
  await queue.obliterate({ force: true });
});

const newDraft = () =>
  drafts.create({
    data: { steps: { '1': { name: 'Service Popescu' } } },
    email: 'owner@example.test',
    language: 'ro',
    step: 5,
  });

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

const filesOf = async (id: string) => {
  const row = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
  return (row.data as { files?: string[] }).files ?? [];
};

async function uploaded(id: string, token: string) {
  const address = await photos.uploadAddress(id, token, {
    checksum: checksumOf(JPEG),
    contentType: 'image/jpeg',
    size: JPEG.length,
  });
  const put = await fetch(address.url, {
    body: new Uint8Array(JPEG),
    headers: address.headers,
    method: 'PUT',
  });
  expect(put.status).toBe(200);
  return address.key;
}

describe('a retried confirm against hostile timing', () => {
  it('holds one photo when the same key is confirmed five times at once', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);

    const answers = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        photos.confirm(draft.id, draft.token, key),
      ),
    );

    const fulfilled = answers.flatMap((a) =>
      a.status === 'fulfilled' ? [a.value] : [],
    );
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(new Set(fulfilled.map((a) => a.key)).size).toBe(1);
    expect(new Set(fulfilled.map((a) => a.position))).toEqual(new Set([0]));
    expect(await filesOf(draft.id)).toEqual([key.replace(/^incoming\//, '')]);
  });

  it('queues one processing job however many times the key is confirmed', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);

    await photos.confirm(draft.id, draft.token, key);
    await photos.confirm(draft.id, draft.token, key);
    await photos.confirm(draft.id, draft.token, key);

    expect(await queue.getJobCountByTypes('waiting', 'active', 'delayed')).toBe(
      1,
    );
  });

  it('does not bring a removed photo back when the confirm is retried after the delete', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    const confirmed = await photos.confirm(draft.id, draft.token, key);
    await photos.remove(draft.id, draft.token, confirmed.key);

    const refused = await refusalOf(photos.confirm(draft.id, draft.token, key));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await filesOf(draft.id)).toEqual([]);
  });

  it('keeps the position of the first confirm when a later photo joined before the retry', async () => {
    const draft = await newDraft();
    const first = await uploaded(draft.id, draft.token);
    const one = await photos.confirm(draft.id, draft.token, first);
    await photos.confirm(
      draft.id,
      draft.token,
      await uploaded(draft.id, draft.token),
    );

    const again = await photos.confirm(draft.id, draft.token, first);

    expect(again).toEqual(one);
    expect(again.position).toBe(0);
  });

  it('answers a repeated confirm with the position and processed state the read reports', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    await photos.confirm(draft.id, draft.token, key);

    const again = await photos.confirm(draft.id, draft.token, key);
    const [listed] = (await photos.list(draft.id, draft.token)).photos;

    expect(listed).toMatchObject({
      key: again.key,
      position: again.position,
      processed: again.processed,
    });
  });

  it('answers a repeated confirm with a wrong token as any wrong token, not with the photo', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    await photos.confirm(draft.id, draft.token, key);

    const wrong = await refusalOf(
      photos.confirm(draft.id, 'x'.repeat(43), key),
    );
    const missing = await refusalOf(photos.confirm(draft.id, undefined, key));

    expect([wrong.status, missing.status]).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify([wrong.body, missing.body])).not.toContain(
      key.replace(/^incoming\//, ''),
    );
  });

  it('refuses the final key itself as an incoming key and holds the photo once', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    const confirmed = await photos.confirm(draft.id, draft.token, key);

    const refused = await refusalOf(
      photos.confirm(draft.id, draft.token, confirmed.key),
    );

    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await filesOf(draft.id)).toEqual([confirmed.key]);
  });

  it('refuses another draft`s final key repeated as incoming under this draft', async () => {
    const draft = await newDraft();
    const other = await newDraft();
    const key = await uploaded(other.id, other.token);
    const confirmed = await photos.confirm(other.id, other.token, key);

    const refused = await refusalOf(
      photos.confirm(
        draft.id,
        draft.token,
        `incoming/garage_photo/${draft.id}/${confirmed.key.split('/').pop()}`,
      ),
    );

    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await filesOf(draft.id)).toEqual([]);
  });
});
