import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  galleryWorld,
  ownerPhotosWorld,
  refusalOf,
} from './owner-photos.testing';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

// @traces 1249-FR-005 1249-FR-006 1249-FR-007 1249-FR-009 1249-FR-010

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const { confirmed, parts, processed, store } = ownerPhotosWorld(prisma);

let since: Date;

beforeEach(async () => {
  await reset();
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

type World = Awaited<ReturnType<typeof galleryWorld>>;
const world = () => galleryWorld(prisma, account, processed);

const save = (w: World, body: unknown) =>
  parts.save.save(w.owner, w.nord.id, body);

const gallery = (garageId: string) =>
  prisma.garagePhoto.findMany({
    orderBy: { position: 'asc' },
    select: { caption: true, fileKey: true, id: true, position: true },
    where: { garageId },
  });

const stamp = async (garageId: string) =>
  (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }))
    .profileVersion;

const history = (garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: [{ subjectId: 'asc' }, { field: 'asc' }],
    select: {
      action: true,
      actorId: true,
      field: true,
      newValue: true,
      oldValue: true,
      subjectId: true,
    },
    where: { at: { gte: since }, garageId, subjectType: 'garage_photo' },
  });

const events = (garageId: string) =>
  prisma.outboxEvent.findMany({
    where: { createdAt: { gte: since }, subjectId: garageId },
  });

// What a refused save must leave as it was.
async function nothingWritten(w: World, run: () => Promise<unknown>) {
  const before = {
    rows: await gallery(w.nord.id),
    stamp: await stamp(w.nord.id),
  };
  await run();
  expect(await gallery(w.nord.id)).toEqual(before.rows);
  expect(await stamp(w.nord.id)).toBe(before.stamp);
  expect(await history(w.nord.id)).toEqual([]);
  expect(await events(w.nord.id)).toEqual([]);
}

const sorted = <T extends { subjectId: string; field: string | null }>(
  entries: T[],
) =>
  [...entries].sort((x, y) =>
    `${x.subjectId}${x.field ?? ''}`.localeCompare(
      `${y.subjectId}${y.field ?? ''}`,
    ),
  );

describe('the stamp', () => {
  it('refuses a stale stamp with 409, writing nothing', async () => {
    const w = await world();

    await nothingWritten(w, async () => {
      expect(
        await refusalOf(
          save(w, {
            photos: [{ id: w.c.id }, { id: w.a.id }],
            version: String(w.nord.profileVersion - 1),
          }),
        ),
      ).toMatchObject({ body: { code: 'profile_changed' }, status: 409 });
    });
  });

  it('lets exactly one of two saves with one stamp write', async () => {
    const w = await world();
    const version = String(w.nord.profileVersion);

    const results = await Promise.allSettled([
      save(w, { photos: [{ id: w.c.id }, { id: w.a.id }], version }),
      save(w, { photos: [{ id: w.b.id }], version }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(await stamp(w.nord.id)).toBe(w.nord.profileVersion + 1);
    expect(await events(w.nord.id)).toHaveLength(1);
  });

  it('refuses in order: rules, unknown photo, missing file, processing, stale stamp', async () => {
    const w = await world();
    const unprocessed = await confirmed(w.owner, w.nord.id);
    const missing = `garage_photo/${w.nord.id}/${randomUUID()}`;
    const stale = String(w.nord.profileVersion + 5);
    const cases = [
      [{ photos: [], version: stale }, 400, 'validation_failed'],
      [
        { photos: [{ id: randomUUID() }, { key: missing }], version: stale },
        400,
        'unknown_photo',
      ],
      [
        {
          photos: [{ key: unprocessed.key }, { key: missing }],
          version: stale,
        },
        409,
        'file_missing',
      ],
      [
        { photos: [{ key: unprocessed.key }], version: stale },
        409,
        'photo_processing',
      ],
      [{ photos: [{ id: w.a.id }], version: stale }, 409, 'profile_changed'],
    ] as const;

    for (const [body, status, code] of cases) {
      await nothingWritten(w, async () => {
        expect(await refusalOf(save(w, body))).toMatchObject({
          body: { code },
          status,
        });
      });
    }
  });

  it('names the entry a rule refuses', async () => {
    const w = await world();

    const refused = await refusalOf(
      save(w, {
        photos: [{ id: w.a.id }, { caption: 'x'.repeat(81), id: w.b.id }],
        version: String(w.nord.profileVersion),
      }),
    );

    expect(refused.body.errors?.map((e) => e.field)).toEqual([
      'photos[1].caption',
    ]);
  });
});

describe('saving the gallery', () => {
  it('moves C first: three ids kept, three position entries, one event, the stamp bumped', async () => {
    const w = await world();

    const answer = await save(w, {
      photos: [{ id: w.c.id }, { id: w.a.id }, { caption: 'Hala', id: w.b.id }],
      version: String(w.nord.profileVersion),
    });

    expect(answer.version).toBe(String(w.nord.profileVersion + 1));
    expect((await gallery(w.nord.id)).map((r) => r.id)).toEqual([
      w.c.id,
      w.a.id,
      w.b.id,
    ]);
    const moved = (
      id: string,
      from: number,
      to: number,
      caption = null as string | null,
    ) => ({
      action: 'update',
      actorId: w.owner.accountId,
      field: 'position',
      newValue: { caption, position: to },
      oldValue: { caption, position: from },
      subjectId: id,
    });
    expect(sorted(await history(w.nord.id))).toEqual(
      sorted([
        moved(w.a.id, 1, 2),
        moved(w.b.id, 2, 3, 'Hala'),
        moved(w.c.id, 3, 1),
      ]),
    );
    const [event] = await events(w.nord.id);
    expect(await events(w.nord.id)).toHaveLength(1);
    expect(event).toMatchObject({
      audience: expect.arrayContaining([`public:garage:${w.nord.id}`]),
      kind: 'garage.updated',
      payload: { fields: ['photos'], garageId: w.nord.id },
    });
    expect(event?.audience).not.toContain('public:search');
  });

  it("removes B: B's delete and C's position, and B's file with its copies after the commit", async () => {
    const w = await world();

    await save(w, {
      photos: [{ id: w.a.id }, { id: w.c.id }],
      version: String(w.nord.profileVersion),
    });

    expect(sorted(await history(w.nord.id))).toEqual(
      sorted([
        {
          action: 'delete',
          actorId: w.owner.accountId,
          field: null,
          newValue: null,
          oldValue: { caption: 'Hala', position: 2 },
          subjectId: w.b.id,
        },
        {
          action: 'update',
          actorId: w.owner.accountId,
          field: 'position',
          newValue: { caption: null, position: 2 },
          oldValue: { caption: null, position: 3 },
          subjectId: w.c.id,
        },
      ]),
    );
    expect(store.objects.has(w.b.fileKey)).toBe(false);
    expect(store.objects.has(`${w.b.fileKey}.thumb`)).toBe(false);
    expect(store.objects.has(`${w.b.fileKey}.display`)).toBe(false);
    expect(store.objects.has(w.a.fileKey)).toBe(true);
  });

  it('adds D with its sizes, variant path and preview, and a create entry by place and caption', async () => {
    const w = await world();
    const d = await confirmed(w.owner, w.nord.id);
    await processed(d.key);

    await save(w, {
      photos: [
        { id: w.a.id },
        { caption: 'Hala', id: w.b.id },
        { id: w.c.id },
        { caption: ' Rampa nouă ', key: d.key },
      ],
      version: String(w.nord.profileVersion),
    });

    const added = await prisma.garagePhoto.findUniqueOrThrow({
      where: { fileKey: d.key },
    });
    expect(added).toMatchObject({
      caption: 'Rampa nouă',
      height: 600,
      position: 3,
      thumbhash: 'HBkSHYSIeHiPiHh8eJd4eTN0EEQG',
      variantPath: expect.stringMatching(`^g/${w.nord.id}/[0-9a-f]{64}$`),
      width: 800,
    });
    expect(await history(w.nord.id)).toEqual([
      {
        action: 'create',
        actorId: w.owner.accountId,
        field: null,
        newValue: { caption: 'Rampa nouă', position: 4 },
        oldValue: null,
        subjectId: added.id,
      },
    ]);
    expect(JSON.stringify(await history(w.nord.id))).not.toMatch(
      /garage_photo\/|g\/|https?:/,
    );
  });

  it('writes a caption change on caption, and a photo moved and captioned as two entries', async () => {
    const w = await world();

    await save(w, {
      photos: [
        { id: w.a.id },
        { id: w.c.id },
        { caption: 'Hala mare', id: w.b.id },
      ],
      version: String(w.nord.profileVersion),
    });

    const b = (await history(w.nord.id)).filter((e) => e.subjectId === w.b.id);
    expect(b.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      [
        'caption',
        { caption: 'Hala', position: 2 },
        { caption: 'Hala mare', position: 3 },
      ],
      [
        'position',
        { caption: 'Hala', position: 2 },
        { caption: 'Hala mare', position: 3 },
      ],
    ]);
  });

  it('writes nothing for a save that changes nothing, and keeps the stamp', async () => {
    const w = await world();

    await nothingWritten(w, async () => {
      const answer = await save(w, {
        photos: [
          { id: w.a.id },
          { caption: ' Hala ', id: w.b.id },
          { id: w.c.id },
        ],
        version: String(w.nord.profileVersion),
      });
      expect(answer.version).toBe(String(w.nord.profileVersion));
    });
  });

  it('leaves nothing when the last write inside the save fails', async () => {
    const w = await world();

    await nothingWritten(w, async () => {
      await prisma.$executeRaw`ALTER TABLE outbox_event ADD CONSTRAINT owner_photos_test_fail CHECK (false) NOT VALID`;
      try {
        await expect(
          save(w, {
            photos: [{ id: w.c.id }, { id: w.a.id }],
            version: String(w.nord.profileVersion),
          }),
        ).rejects.toThrow();
      } finally {
        await prisma.$executeRaw`ALTER TABLE outbox_event DROP CONSTRAINT owner_photos_test_fail`;
      }
    });
    expect(store.objects.has(w.b.fileKey)).toBe(true);
  });

  it('logs a removed file storage cannot delete, with the garage id, and still answers', async () => {
    const w = await world();
    store.beforeDelete = () => {
      throw new Error('storage down');
    };
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const answer = await save(w, {
      photos: [{ id: w.a.id }],
      version: String(w.nord.profileVersion),
    });

    expect(answer.photos.map((p) => p.id)).toEqual([w.a.id]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(w.nord.id));
  });
});
