import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import {
  galleryWorld,
  JPEG,
  ownerPhotosWorld,
  refusalOf,
} from './owner-photos.testing';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

// @traces 1249-FR-001 1249-FR-002 1249-FR-003 1249-FR-004 1249-FR-008
// @traces 1249-FR-021

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const { confirmed, limits, parts, processed, queue, store } =
  ownerPhotosWorld(prisma);

let since: Date;

beforeEach(async () => {
  await reset();
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
});

afterAll(() => prisma.$disconnect());

const world = (status?: 'approved' | 'pending' | 'suspended') =>
  galleryWorld(prisma, account, processed, status);

const FILE = { checksum: 'AAAAAA==', contentType: 'image/jpeg', size: 1000 };

// What a refused or abandoned upload must leave as it was.
async function untouched(garageId: string, run: () => Promise<unknown>) {
  const before = await prisma.garage.findUniqueOrThrow({
    include: { photos: { orderBy: { position: 'asc' } } },
    where: { id: garageId },
  });
  await run();
  const after = await prisma.garage.findUniqueOrThrow({
    include: { photos: { orderBy: { position: 'asc' } } },
    where: { id: garageId },
  });
  expect(after.profileVersion).toBe(before.profileVersion);
  expect(after.photos).toEqual(before.photos);
  expect(
    await prisma.activityLog.count({ where: { at: { gte: since }, garageId } }),
  ).toBe(0);
  expect(
    await prisma.outboxEvent.count({
      where: { createdAt: { gte: since }, subjectId: garageId },
    }),
  ).toBe(0);
}

describe('who reaches the gallery', () => {
  it.each([
    ['receptionist', 403],
    ['mechanic', 403],
    ['other', 404],
  ] as const)('refuses the %s with %i on every route', async (who, status) => {
    const w = await world();
    const as = w[who];
    const id = randomUUID();
    const calls = [
      parts.service.list(as, w.nord.id),
      parts.service.uploadAddress(as, w.nord.id, FILE),
      parts.service.confirm(
        as,
        w.nord.id,
        `incoming/garage_photo/${w.nord.id}/${id}`,
      ),
      parts.service.upload(as, w.nord.id, id),
      parts.service.removeUpload(as, w.nord.id, id),
      parts.save.save(as, w.nord.id, { photos: [], version: '0' }),
    ];

    for (const call of calls) {
      expect((await refusalOf(call)).status).toBe(status);
    }
  });

  it('answers 404 for a garage not yet approved and 410 for a suspended one', async () => {
    const pending = await world('pending');
    expect(
      (await refusalOf(parts.service.list(pending.owner, pending.nord.id)))
        .status,
    ).toBe(404);
    await reset();
    const suspended = await world('suspended');
    const writes = [
      parts.service.uploadAddress(suspended.owner, suspended.nord.id, FILE),
      parts.save.save(suspended.owner, suspended.nord.id, {
        photos: [{ id: suspended.a.id }],
        version: '0',
      }),
    ];
    for (const write of writes) {
      expect(await refusalOf(write)).toMatchObject({
        body: { code: 'gone' },
        status: 410,
      });
    }
  });
});

describe("the owner's gallery read", () => {
  it('answers the stamp and the photos in order with signed thumbnails and no key', async () => {
    const w = await world();

    const read = await parts.service.list(w.owner, w.nord.id);

    expect(read.version).toBe(String(w.nord.profileVersion));
    expect(read.photos.map((p) => [p.id, p.position, p.caption])).toEqual([
      [w.a.id, 0, null],
      [w.b.id, 1, 'Hala'],
      [w.c.id, 2, null],
    ]);
    expect(read.photos[0]).toMatchObject({
      height: 600,
      processed: true,
      width: 800,
    });
    const url = new URL(read.photos[0]?.thumbnailUrl ?? '');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    const body = JSON.stringify(read);
    expect(body).not.toContain('"garage_photo/');
    expect(body).not.toContain('fileKey');
  });
});

describe("the owner's uploads", () => {
  it('signs an upload under the garage, keyed by the garage for the rate limit', async () => {
    const w = await world();

    const address = await parts.service.uploadAddress(w.owner, w.nord.id, FILE);

    expect(address.key).toMatch(
      new RegExp(`^incoming/garage_photo/${w.nord.id}/[0-9a-f-]{36}$`),
    );
    expect(limits.take).toHaveBeenCalledWith('uploadUrl', w.nord.id);
  });

  it.each([
    [
      'a type the gallery refuses',
      { ...FILE, contentType: 'image/gif' },
      'file_type_not_allowed',
    ],
    [
      'a file over 10 MB',
      { ...FILE, size: 10 * 1024 * 1024 + 1 },
      'file_too_large',
    ],
  ])('refuses %s with 422', async (_, file, code) => {
    const w = await world();

    await untouched(w.nord.id, async () => {
      expect(
        await refusalOf(parts.service.uploadAddress(w.owner, w.nord.id, file)),
      ).toMatchObject({ body: { code }, status: 422 });
    });
  });

  it('refuses an upload address when the gallery holds 20 photos', async () => {
    const w = await world();
    await prisma.garagePhoto.createMany({
      data: Array.from({ length: 17 }, (_, n) => ({
        fileKey: `garage_photo/${randomUUID()}/${randomUUID()}`,
        garageId: w.nord.id,
        position: n + 3,
      })),
    });

    expect(
      await refusalOf(parts.service.uploadAddress(w.owner, w.nord.id, FILE)),
    ).toMatchObject({ body: { code: 'photos_full' }, status: 422 });
  });

  it('answers 429 when the garage has asked too often', async () => {
    const w = await world();
    limits.take.mockRejectedValue(
      new HttpException({ code: 'rate_limited', message: 'Wait' }, 429),
    );

    expect(
      (await refusalOf(parts.service.uploadAddress(w.owner, w.nord.id, FILE)))
        .status,
    ).toBe(429);
  });

  it('confirms an upload, queues its copies once, and adds nothing to the gallery', async () => {
    const w = await world();

    await untouched(w.nord.id, async () => {
      const photo = await confirmed(w.owner, w.nord.id);

      expect(photo).toEqual({
        key: expect.stringMatching(`^garage_photo/${w.nord.id}/`),
        processed: false,
      });
      expect((await queue.getJob(photo.key))?.data).toEqual({ key: photo.key });
      const again = await parts.service.confirm(
        w.owner,
        w.nord.id,
        `incoming/${photo.key}`,
      );
      expect(again).toEqual(photo);
      expect(await queue.getJobCounts('waiting', 'delayed')).toMatchObject({
        waiting: 1,
      });
    });
  });

  it('refuses a file that is not the type declared, deleting it', async () => {
    const w = await world();
    const address = await parts.service.uploadAddress(w.owner, w.nord.id, FILE);
    store.put(address.key, Buffer.from('not a jpeg'), 'image/jpeg');

    expect(
      await refusalOf(parts.service.confirm(w.owner, w.nord.id, address.key)),
    ).toMatchObject({ body: { code: 'file_type_mismatch' }, status: 422 });
    expect(store.objects.has(address.key)).toBe(false);
  });

  it('answers 409 when nothing was uploaded and 404 for a key of another garage', async () => {
    const w = await world();
    const address = await parts.service.uploadAddress(w.owner, w.nord.id, FILE);

    expect(
      await refusalOf(parts.service.confirm(w.owner, w.nord.id, address.key)),
    ).toMatchObject({ body: { code: 'file_missing' }, status: 409 });
    const theirs = `incoming/garage_photo/${w.other.garageId}/${randomUUID()}`;
    store.put(theirs, JPEG, 'image/jpeg');
    expect(
      await refusalOf(parts.service.confirm(w.owner, w.nord.id, theirs)),
    ).toMatchObject({ body: { code: 'not_found' }, status: 404 });
    expect(store.objects.has(theirs)).toBe(true);
  });

  it('reads an upload as its copies are made', async () => {
    const w = await world();
    const photo = await confirmed(w.owner, w.nord.id);
    const id = photo.key.split('/')[2] as string;

    expect(await parts.service.upload(w.owner, w.nord.id, id)).toEqual({
      key: photo.key,
      processed: false,
    });
    await processed(photo.key);
    expect(await parts.service.upload(w.owner, w.nord.id, id)).toMatchObject({
      height: 600,
      processed: true,
      thumbnailUrl: expect.any(String),
      width: 800,
    });
  });

  it('deletes an unsaved upload with its copies', async () => {
    const w = await world();
    const photo = await confirmed(w.owner, w.nord.id);
    await processed(photo.key);

    await untouched(w.nord.id, () =>
      parts.service.removeUpload(
        w.owner,
        w.nord.id,
        photo.key.split('/')[2] as string,
      ),
    );

    expect(store.objects.has(photo.key)).toBe(false);
    expect(store.objects.has(`${photo.key}.thumb`)).toBe(false);
    expect(store.objects.has(`${photo.key}.display`)).toBe(false);
  });

  it('refuses to delete a photo the gallery holds, and answers 404 for an unknown one', async () => {
    const w = await world();
    const saved = `garage_photo/${w.nord.id}/${randomUUID()}`;
    await processed(saved);
    await prisma.garagePhoto.create({
      data: { fileKey: saved, garageId: w.nord.id, position: 3 },
    });

    expect(
      await refusalOf(
        parts.service.removeUpload(
          w.owner,
          w.nord.id,
          saved.split('/')[2] as string,
        ),
      ),
    ).toMatchObject({ body: { code: 'photo_in_gallery' }, status: 409 });
    expect(store.objects.has(saved)).toBe(true);
    expect(
      (
        await refusalOf(
          parts.service.removeUpload(w.owner, w.nord.id, randomUUID()),
        )
      ).status,
    ).toBe(404);
  });
});
