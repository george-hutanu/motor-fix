import { randomUUID } from 'node:crypto';

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
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageService } from '../../../storage/storage.service';
import { ListingDraftsService } from '../../listing-drafts/listing-drafts.service';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const TEN_MB = 10 * 1024 * 1024;

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
  photos = new ListingPhotosService(prisma, drafts, storage, queue);
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

const hold = (id: string, count: number) =>
  prisma.listingDraft.update({
    data: {
      data: {
        files: Array.from(
          { length: count },
          () => `garage_photo/${id}/${randomUUID()}`,
        ),
      },
    },
    where: { id },
  });

async function uploaded(id: string, token: string, file = JPEG) {
  const address = await photos.uploadAddress(id, token, {
    contentType: 'image/jpeg',
    size: file.length,
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(address.fields)) {
    form.append(name, value);
  }
  form.append('file', new Blob([new Uint8Array(file)]));
  const posted = await fetch(address.url, { body: form, method: 'POST' });
  expect(posted.status).toBe(204);
  return address.key;
}

describe('the upload address', () => {
  it('is signed for the draft for 15 minutes under an incoming key it owns', async () => {
    const draft = await newDraft();
    const before = Date.now();

    const address = await photos.uploadAddress(draft.id, draft.token, {
      contentType: 'image/jpeg',
      size: 3 * 1024 * 1024,
    });

    expect(address.key).toMatch(
      new RegExp(`^incoming/garage_photo/${draft.id}/[0-9a-f-]{36}$`),
    );
    expect(address.url).toContain(store.env().STORAGE_ENDPOINT);
    const minutes = (Date.parse(address.expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThanOrEqual(15.1);
  });

  it('answers a wrong, foreign or missing token as the draft routes answer a wrong one', async () => {
    const draft = await newDraft();
    const other = await newDraft();
    const unknown = await refusalOf(drafts.current('not-a-key'));

    for (const token of ['not-a-key', other.token, undefined]) {
      const refused = await refusalOf(
        photos.uploadAddress(draft.id, token, {
          contentType: 'image/jpeg',
          size: 100,
        }),
      );
      expect(refused).toEqual(unknown);
    }
    expect(unknown.status).toBe(404);
  });

  it('is refused for a sent draft', async () => {
    const draft = await newDraft();
    await prisma.listingDraft.update({
      data: { status: 'submitted' },
      where: { id: draft.id },
    });

    const refused = await refusalOf(
      photos.uploadAddress(draft.id, draft.token, {
        contentType: 'image/jpeg',
        size: 100,
      }),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
  });

  it.each([
    ['a PDF', 'application/pdf', 100, 'file_type_not_allowed'],
    ['a HEIC photo', 'image/heic', 100, 'file_type_not_allowed'],
    ['a photo over 10 MB', 'image/jpeg', TEN_MB + 1, 'file_too_large'],
  ])('refuses %s with a stable code', async (_, contentType, size, code) => {
    const draft = await newDraft();

    const refused = await refusalOf(
      photos.uploadAddress(draft.id, draft.token, { contentType, size }),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code });
  });

  it('is refused with photos_full once the draft holds 20 photos', async () => {
    const draft = await newDraft();
    await hold(draft.id, 20);

    const refused = await refusalOf(
      photos.uploadAddress(draft.id, draft.token, {
        contentType: 'image/jpeg',
        size: 100,
      }),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'photos_full' });
  });
});

describe('confirming a photo', () => {
  it('adds the photo at the end of the draft and answers it unprocessed', async () => {
    const draft = await newDraft();
    const first = await uploaded(draft.id, draft.token);
    const second = await uploaded(draft.id, draft.token);

    const one = await photos.confirm(draft.id, draft.token, first);
    const two = await photos.confirm(draft.id, draft.token, second);

    expect(one).toEqual({
      key: first.replace(/^incoming\//, ''),
      position: 0,
      processed: false,
    });
    expect(two).toMatchObject({ position: 1, processed: false });
    expect(await filesOf(draft.id)).toEqual([one.key, two.key]);
    expect(store.objects.has(one.key)).toBe(true);
    expect(store.objects.has(first)).toBe(false);
  });

  it('queues one processing job per photo, under the photo key', async () => {
    const draft = await newDraft();
    const confirmed = await photos.confirm(
      draft.id,
      draft.token,
      await uploaded(draft.id, draft.token),
    );

    const job = await queue.getJob(confirmed.key);

    expect(job?.data).toEqual({ key: confirmed.key });
    expect(job?.opts.attempts).toBe(3);
  });

  it('refuses the 21st photo and deletes what was uploaded', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    await hold(draft.id, 20);

    const refused = await refusalOf(photos.confirm(draft.id, draft.token, key));

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'photos_full' });
    expect(await filesOf(draft.id)).toHaveLength(20);
    expect(store.objects.size).toBe(0);
    expect(await queue.count()).toBe(0);
  });

  it('refuses bytes that are not a photo and stores nothing', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token, Buffer.from('%PDF-1.7'));

    const refused = await refusalOf(photos.confirm(draft.id, draft.token, key));

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'file_type_mismatch' });
    expect(await filesOf(draft.id)).toEqual([]);
    expect(store.objects.size).toBe(0);
  });

  it('answers a replayed confirm with file_missing and holds the photo once', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    await photos.confirm(draft.id, draft.token, key);

    const refused = await refusalOf(photos.confirm(draft.id, draft.token, key));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await filesOf(draft.id)).toHaveLength(1);
  });

  it('keeps the photo once when a second confirm of it passed storage at the same time', async () => {
    const draft = await newDraft();
    await hold(draft.id, 18);
    const incoming = await uploaded(draft.id, draft.token);
    const confirmed = await photos.confirm(draft.id, draft.token, incoming);
    const racing = jest
      .spyOn(storage, 'confirmUpload')
      .mockResolvedValueOnce(confirmed.key);

    const refused = await refusalOf(
      photos.confirm(draft.id, draft.token, incoming),
    );

    racing.mockRestore();
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    const files = await filesOf(draft.id);
    expect(files.filter((key) => key === confirmed.key)).toHaveLength(1);
    expect(files).toHaveLength(19);
    expect(store.objects.has(confirmed.key)).toBe(true);
  });

  it('refuses a key uploaded for another draft', async () => {
    const draft = await newDraft();
    const other = await newDraft();
    const key = await uploaded(other.id, other.token);

    const refused = await refusalOf(photos.confirm(draft.id, draft.token, key));

    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await filesOf(draft.id)).toEqual([]);
  });

  it('refuses a photo for a draft sent meanwhile and deletes the upload', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);
    await prisma.listingDraft.update({
      data: { status: 'submitted' },
      where: { id: draft.id },
    });

    const refused = await refusalOf(photos.confirm(draft.id, draft.token, key));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
    expect(store.objects.size).toBe(0);
  });

  it('touches nothing for a wrong token', async () => {
    const draft = await newDraft();
    const key = await uploaded(draft.id, draft.token);

    const refused = await refusalOf(photos.confirm(draft.id, 'wrong', key));

    expect(refused.status).toBe(404);
    expect(store.objects.has(key)).toBe(true);
    expect(await filesOf(draft.id)).toEqual([]);
  });
});

describe('reading the photos', () => {
  it('answers them in the draft order, a processed one with its size and a short-lived thumbnail address', async () => {
    const draft = await newDraft();
    const a = await photos.confirm(
      draft.id,
      draft.token,
      await uploaded(draft.id, draft.token),
    );
    const b = await photos.confirm(
      draft.id,
      draft.token,
      await uploaded(draft.id, draft.token),
    );
    await storage.putObject(`${b.key}.thumb`, JPEG, 'image/jpeg', {
      height: '900',
      width: '1200',
    });

    const read = await photos.list(draft.id, draft.token);

    expect(read.photos).toEqual([
      { key: a.key, position: 0, processed: false },
      {
        height: 900,
        key: b.key,
        position: 1,
        processed: true,
        thumbnailUrl: expect.any(String),
        width: 1200,
      },
    ]);
    const url = new URL(read.photos[1]?.thumbnailUrl ?? '');
    expect(decodeURIComponent(url.pathname)).toContain(`${b.key}.thumb`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('queues the processing again for a photo whose job was lost', async () => {
    const draft = await newDraft();
    const photo = await photos.confirm(
      draft.id,
      draft.token,
      await uploaded(draft.id, draft.token),
    );
    await queue.obliterate({ force: true });

    await photos.list(draft.id, draft.token);

    expect((await queue.getJob(photo.key))?.data).toEqual({ key: photo.key });
  });

  it('is refused for a wrong token and for a sent draft', async () => {
    const draft = await newDraft();

    expect((await refusalOf(photos.list(draft.id, 'wrong'))).status).toBe(404);
    await prisma.listingDraft.update({
      data: { status: 'submitted' },
      where: { id: draft.id },
    });
    expect((await refusalOf(photos.list(draft.id, draft.token))).status).toBe(
      409,
    );
  });
});

describe('describing photos for the sending', () => {
  it('answers each key with the size of the processed ones, in the order given', async () => {
    const draft = await newDraft();
    const [a, b] = [
      `garage_photo/${draft.id}/${randomUUID()}`,
      `garage_photo/${draft.id}/${randomUUID()}`,
    ];
    await storage.putObject(`${a}.thumb`, JPEG, 'image/jpeg', {
      height: '600',
      width: '800',
    });

    expect(await photos.describe([b, a])).toEqual([
      { key: b },
      { height: 600, key: a, width: 800 },
    ]);
  });
});
