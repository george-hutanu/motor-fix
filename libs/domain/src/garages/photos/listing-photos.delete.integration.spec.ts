import { randomUUID } from 'node:crypto';

import { HttpException, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  LISTING_PHOTOS_QUEUE,
  ListingPhotosService,
} from './listing-photos.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageService } from '../../storage/storage.service';
import { ListingDraftsService } from '../listing-drafts.service';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);

const store = new S3TestStore();
const queue = new Queue(LISTING_PHOTOS_QUEUE, {
  connection: { url: redisUrlFor(14) },
});
const drafts = new ListingDraftsService(
  prisma,
  { sendToDraft: async () => undefined } as unknown as NotificationsService,
  { webUrl: 'https://motorfix.test' } as never,
);
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
  store.beforeDelete = undefined;
  await queue.obliterate({ force: true });
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

// A draft holding `count` processed photos, as the confirm and the worker
// would have left it.
async function draftWith(count: number) {
  const draft = await drafts.create({
    data: { steps: { '1': { name: 'Service Popescu' } } },
    email: 'owner@example.test',
    language: 'ro',
    step: 5,
  });
  const keys = Array.from(
    { length: count },
    () => `garage_photo/${draft.id}/${randomUUID()}`,
  );
  for (const key of keys) {
    store.put(key, JPEG, 'image/jpeg');
    store.put(`${key}.thumb`, JPEG, 'image/jpeg');
    store.put(`${key}.display`, JPEG, 'image/jpeg');
  }
  await prisma.listingDraft.update({
    data: {
      data: { files: keys, steps: { '1': { name: 'Service Popescu' } } },
    },
    where: { id: draft.id },
  });
  return { ...draft, keys };
}

describe('removing a photo', () => {
  it('takes the key out of the draft and deletes the photo with its copies', async () => {
    const draft = await draftWith(3);
    const [first, second, third] = draft.keys as [string, string, string];

    await photos.remove(draft.id, draft.token, second);

    expect(await filesOf(draft.id)).toEqual([first, third]);
    expect(store.objects.has(second)).toBe(false);
    expect(store.objects.has(`${second}.thumb`)).toBe(false);
    expect(store.objects.has(`${second}.display`)).toBe(false);
    expect(store.objects.has(first)).toBe(true);
  });

  it('answers 404 for a key the draft does not hold and changes nothing', async () => {
    const draft = await draftWith(1);
    const other = await draftWith(1);
    const foreign = other.keys[0] as string;

    const refused = await refusalOf(
      photos.remove(draft.id, draft.token, foreign),
    );

    expect(refused.status).toBe(404);
    expect(store.objects.has(foreign)).toBe(true);
    expect(await filesOf(other.id)).toEqual(other.keys);
  });

  it('still removes the key when storage fails, and logs it', async () => {
    const draft = await draftWith(2);
    const [first, second] = draft.keys as [string, string];
    store.beforeDelete = () => {
      throw new Error('storage down');
    };
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await photos.remove(draft.id, draft.token, first);

    expect(await filesOf(draft.id)).toEqual([second]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(first));
    logged.mockRestore();
  });

  it('keeps the photo of a draft sent after the delete opened it', async () => {
    const draft = await draftWith(2);
    const key = draft.keys[0] as string;
    const open = drafts.open.bind(drafts);
    const opening = jest
      .spyOn(drafts, 'open')
      .mockImplementationOnce(async (...args) => {
        const opened = await open(...args);
        await prisma.listingDraft.update({
          data: { status: 'submitted' },
          where: { id: draft.id },
        });
        return opened;
      });

    const refused = await refusalOf(photos.remove(draft.id, draft.token, key));

    opening.mockRestore();
    expect(refused.status).toBe(409);
    expect(await filesOf(draft.id)).toEqual(draft.keys);
    expect(store.objects.has(key)).toBe(true);
  });

  it('is refused for a wrong token and for a sent draft', async () => {
    const draft = await draftWith(1);
    const key = draft.keys[0] as string;

    expect(
      (await refusalOf(photos.remove(draft.id, 'wrong', key))).status,
    ).toBe(404);
    await prisma.listingDraft.update({
      data: { status: 'submitted' },
      where: { id: draft.id },
    });
    expect(
      (await refusalOf(photos.remove(draft.id, draft.token, key))).status,
    ).toBe(409);
    expect(store.objects.has(key)).toBe(true);
  });
});

describe('saving the draft with its photos', () => {
  const save = (
    draft: { id: string; token: string },
    files: string[] | undefined,
  ) =>
    drafts.save(draft.id, draft.token, {
      data: {
        ...(files && { files }),
        steps: { '1': { name: 'Service Popescu' } },
      },
      language: 'ro',
      step: 5,
    });

  it('keeps the order the visitor chose, the first one being the cover', async () => {
    const draft = await draftWith(3);
    const [a, b, c] = draft.keys as [string, string, string];

    await save(draft, [c, a, b]);

    expect(await filesOf(draft.id)).toEqual([c, a, b]);
  });

  it("refuses a new draft that claims another draft's photo", async () => {
    const other = await draftWith(1);

    const refused = await refusalOf(
      drafts.create({
        data: {
          files: [other.keys[0] as string],
          steps: { '1': { name: 'Service Popescu' } },
        },
        email: 'stranger@example.test',
        language: 'ro',
        step: 5,
      }),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'invalid', field: 'files' }],
    });
    expect(await prisma.listingDraft.count()).toBe(1);
  });

  it('refuses a key the draft does not hold', async () => {
    const draft = await draftWith(2);
    const other = await draftWith(1);

    const refused = await refusalOf(
      save(draft, [...draft.keys, other.keys[0] as string]),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'invalid', field: 'files' }],
    });
    expect(await filesOf(draft.id)).toEqual(draft.keys);
  });

  it('keeps a held photo the save left out, at the end', async () => {
    const draft = await draftWith(3);
    const [a, b, c] = draft.keys as [string, string, string];

    await save(draft, [c, a]);

    expect(await filesOf(draft.id)).toEqual([c, a, b]);
  });

  it('keeps every held photo when the save carries none', async () => {
    const draft = await draftWith(2);

    await save(draft, undefined);

    expect(await filesOf(draft.id)).toEqual(draft.keys);
  });
});
