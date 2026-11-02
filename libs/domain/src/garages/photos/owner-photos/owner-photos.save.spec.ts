import { Logger } from '@nestjs/common';

import { OwnerPhotosSave } from './owner-photos.save';
import type { Actor } from '../../../auth/policy';

// @traces 1249-FR-005 1249-FR-006 1249-FR-007 1249-FR-008 1249-FR-009
// @traces 1249-FR-010

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const OTHER = '0f6a3c1e-1d7b-4b8e-8f5a-2c9d4e6b7a10';
const uuid = (n: number) =>
  `5e0a8f3b-91c2-4d7e-8b6a-${String(n).padStart(12, '0')}`;
const fileOf = (n: number) => `garage_photo/${OTHER}/${uuid(n)}`;
const upload = (n: number) => `garage_photo/${GARAGE}/${uuid(n)}`;

const A = { caption: null, fileKey: fileOf(1), id: uuid(1), position: 0 };
const B = { caption: 'Hala', fileKey: fileOf(2), id: uuid(2), position: 1 };
const C = { caption: null, fileKey: fileOf(3), id: uuid(3), position: 2 };
type Row = typeof A | typeof B;

const actor = (role: Actor['role'], garageId: string | null = GARAGE) =>
  ({
    accountId: 'owner-1',
    garageId,
    permissions: {},
    role,
    roles: [role],
  }) as unknown as Actor;
const owner = actor('garage');

type Stored = { processed: boolean } | null;

function harness({
  rows = [A, B, C] as Row[],
  status = 'approved',
  version = 4,
  updated = 1,
  stored = {} as Record<string, Stored>,
} = {}) {
  const tx = {
    $queryRaw: vi.fn(async () => [{ profile_version: version, status }]),
    garage: { updateMany: vi.fn(async () => ({ count: updated })) },
    garagePhoto: {
      createManyAndReturn: vi.fn(
        async ({ data }: { data: { fileKey: string }[] }) =>
          data.map((row, n) => ({ ...row, id: uuid(100 + n) })),
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => rows),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: rows.length })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { recordMany: vi.fn(async () => undefined) };
  const events = { record: vi.fn(async () => undefined) };
  const storage = {
    deleteWithCopies: vi.fn(async () => undefined),
    metadataOf: vi.fn(async (key: string) =>
      stored[key] === null ? null : {},
    ),
  };
  const photos = {
    describe: vi.fn(async (keys: string[]) =>
      keys.map((key) =>
        stored[key]?.processed === false
          ? { key }
          : {
              height: 600,
              key,
              thumbhash: 'th',
              variantPath: `g/${GARAGE}/digest`,
              width: 800,
            },
      ),
    ),
  };
  const answer = { photos: [], version: String(version + 1) };
  const gallery = { answer: vi.fn(async () => answer) };
  const save = new OwnerPhotosSave(
    prisma as never,
    audit as never,
    events as never,
    storage as never,
    photos as never,
    gallery as never,
  );
  return {
    answer,
    audit,
    events,
    gallery,
    prisma,
    save: (body: unknown, as: Actor = owner) => save.save(as, GARAGE, body),
    storage,
    tx,
  };
}
type Harness = ReturnType<typeof harness>;

type Refused = {
  getStatus(): number;
  getResponse(): { code: string; errors?: { code: string; field: string }[] };
};
const refused = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => {
      throw new Error('not refused');
    },
    (e: unknown) => e,
  )) as Refused;
  return { status: error.getStatus(), ...error.getResponse() };
};

const nothingWritten = (h: Harness) => {
  expect(h.tx.garagePhoto.updateMany).not.toHaveBeenCalled();
  expect(h.tx.garagePhoto.deleteMany).not.toHaveBeenCalled();
  expect(h.tx.garagePhoto.createManyAndReturn).not.toHaveBeenCalled();
  expect(h.tx.garagePhoto.update).not.toHaveBeenCalled();
  expect(h.tx.garage.updateMany).not.toHaveBeenCalled();
  expect(h.audit.recordMany).not.toHaveBeenCalled();
  expect(h.events.record).not.toHaveBeenCalled();
  expect(h.storage.deleteWithCopies).not.toHaveBeenCalled();
};

type Entry = {
  action: string;
  field?: string;
  subjectId: string;
  oldValue?: unknown;
  newValue?: unknown;
};
const entriesOf = (h: Harness) => {
  const [[, entries]] = h.audit.recordMany.mock.calls as unknown as [
    [unknown, Entry[]],
  ];
  return [...entries].sort((a, b) =>
    `${a.subjectId}${a.field ?? ''}`.localeCompare(
      `${b.subjectId}${b.field ?? ''}`,
    ),
  );
};

const kept = (row: Row, caption?: string) => ({
  id: row.id,
  ...(caption !== undefined && { caption }),
});
const same = [kept(A), kept(B, 'Hala'), kept(C)];

describe("the gallery save's refusals, in order", () => {
  it("answers 404 to another garage's owner before opening a transaction", async () => {
    const h = harness();

    const r = await refused(
      h.save({ photos: same, version: '4' }, actor('garage', OTHER)),
    );

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['receptionist', 'mechanic'] as const)(
    'answers 403 to the %s, whatever the body',
    async (role) => {
      const h = harness();

      const r = await refused(h.save({ photos: [] }, actor(role)));

      expect(r).toMatchObject({ code: 'forbidden', status: 403 });
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('answers 410 for a suspended garage before judging the body', async () => {
    const h = harness({ status: 'suspended' });

    const r = await refused(h.save({ photos: [] }));

    expect(r).toMatchObject({ code: 'gone', status: 410 });
    nothingWritten(h);
  });

  it('answers 404 for a garage not yet approved', async () => {
    const h = harness({ status: 'draft' });

    const r = await refused(h.save({ photos: same, version: '4' }));

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
    nothingWritten(h);
  });

  it('refuses an empty gallery with 400 before an unknown id or a stale stamp', async () => {
    const h = harness();

    const r = await refused(h.save({ photos: [], version: '1' }));

    expect(r).toMatchObject({ code: 'validation_failed', status: 400 });
    nothingWritten(h);
  });

  it('names the entry the rules refuse', async () => {
    const h = harness();

    const r = await refused(
      h.save({
        photos: [kept(A), { id: uuid(2), key: upload(9) }, kept(C)],
        version: '4',
      }),
    );

    expect(r.status).toBe(400);
    expect(r.errors?.map((e) => e.field)).toEqual(['photos[1]']);
    nothingWritten(h);
  });

  it("refuses an upload of another garage's as a key not shaped for this one", async () => {
    const h = harness();

    const r = await refused(
      h.save({ photos: [kept(A), { key: fileOf(9) }], version: '4' }),
    );

    expect(r).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(r.errors?.map((e) => e.field)).toEqual(['photos[1].key']);
    nothingWritten(h);
  });

  it('refuses an id the garage does not hold with 400 before a missing file or a stale stamp', async () => {
    const h = harness({ stored: { [upload(9)]: null } });

    const r = await refused(
      h.save({
        photos: [kept(A), { id: uuid(50) }, { key: upload(9) }],
        version: '1',
      }),
    );

    expect(r).toMatchObject({ code: 'unknown_photo', status: 400 });
    nothingWritten(h);
  });

  it('refuses a key with no stored file with 409 before one still processing', async () => {
    const h = harness({
      stored: { [upload(8)]: { processed: false }, [upload(9)]: null },
    });

    const r = await refused(
      h.save({
        photos: [kept(A), { key: upload(8) }, { key: upload(9) }],
        version: '1',
      }),
    );

    expect(r).toMatchObject({ code: 'file_missing', status: 409 });
    nothingWritten(h);
  });

  it('refuses a photo whose copies are not made yet before a stale stamp', async () => {
    const h = harness({ stored: { [upload(8)]: { processed: false } } });

    const r = await refused(
      h.save({ photos: [{ key: upload(8) }, ...same], version: '1' }),
    );

    expect(r).toMatchObject({ code: 'photo_processing', status: 409 });
    nothingWritten(h);
  });

  it('refuses a stale stamp with 409 profile_changed', async () => {
    const h = harness();

    const r = await refused(
      h.save({ photos: [kept(C), kept(A)], version: '3' }),
    );

    expect(r).toMatchObject({ code: 'profile_changed', status: 409 });
    nothingWritten(h);
  });

  it('answers 409 when the stamp moved under the conditional update, deleting no file', async () => {
    const h = harness({ updated: 0 });

    const r = await refused(
      h.save({ photos: [kept(A), kept(C)], version: '4' }),
    );

    expect(r).toMatchObject({ code: 'profile_changed', status: 409 });
    expect(h.tx.garage.updateMany).toHaveBeenCalledWith({
      data: { profileVersion: { increment: 1 } },
      where: { id: GARAGE, profileVersion: 4 },
    });
    expect(h.storage.deleteWithCopies).not.toHaveBeenCalled();
    expect(h.gallery.answer).not.toHaveBeenCalled();
  });
});

describe('the gallery save', () => {
  it('locks the garage row before reading the gallery', async () => {
    const h = harness();

    await h.save({ photos: [kept(C), kept(A), kept(B, 'Hala')], version: '4' });

    const [[sql]] = h.tx.$queryRaw.mock.calls as unknown as [
      [TemplateStringsArray],
    ];
    expect(sql.join('?')).toMatch(/FOR UPDATE OF g/);
  });

  it('moves C first: three ids kept, three position entries, one event, the stamp bumped', async () => {
    const h = harness();

    const answer = await h.save({
      photos: [kept(C), kept(A), kept(B, 'Hala')],
      version: '4',
    });

    expect(answer).toBe(h.answer);
    expect(h.tx.garagePhoto.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.garagePhoto.createManyAndReturn).not.toHaveBeenCalled();
    expect(h.tx.garagePhoto.update.mock.calls).toEqual(
      expect.arrayContaining([
        [{ data: { caption: null, position: 0 }, where: { id: C.id } }],
        [{ data: { caption: null, position: 1 }, where: { id: A.id } }],
        [{ data: { caption: 'Hala', position: 2 }, where: { id: B.id } }],
      ]),
    );
    expect(entriesOf(h)).toEqual([
      expect.objectContaining({
        action: 'update',
        field: 'position',
        newValue: { caption: null, position: 2 },
        oldValue: { caption: null, position: 1 },
        subjectId: A.id,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'position',
        newValue: { caption: 'Hala', position: 3 },
        oldValue: { caption: 'Hala', position: 2 },
        subjectId: B.id,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'position',
        newValue: { caption: null, position: 1 },
        oldValue: { caption: null, position: 3 },
        subjectId: C.id,
      }),
    ]);
    expect(h.events.record).toHaveBeenCalledTimes(1);
    expect(h.events.record).toHaveBeenCalledWith(h.tx, {
      audience: { garageId: GARAGE, results: false, type: 'public_garage' },
      kind: 'garage.updated',
      payload: { fields: ['photos'], garageId: GARAGE },
      subjectId: GARAGE,
    });
    expect(h.tx.garage.updateMany).toHaveBeenCalledTimes(1);
  });

  it('parks every position past the cap before writing the new ones', async () => {
    const h = harness();

    await h.save({
      photos: [{ key: upload(4) }, kept(C), kept(A), kept(B, 'Hala')],
      version: '4',
    });

    expect(h.tx.garagePhoto.updateMany).toHaveBeenCalledWith({
      data: { position: { increment: 20 } },
      where: { garageId: GARAGE },
    });
    const parked = h.tx.garagePhoto.updateMany.mock.invocationCallOrder[0];
    expect(parked).toBeLessThan(
      Math.min(...h.tx.garagePhoto.update.mock.invocationCallOrder),
    );
    expect(parked).toBeLessThan(
      h.tx.garagePhoto.createManyAndReturn.mock.invocationCallOrder[0],
    );
  });

  it("removes B: B's delete and C's position, then B's file after the commit", async () => {
    const h = harness();

    await h.save({ photos: [kept(A), kept(C)], version: '4' });

    expect(h.tx.garagePhoto.deleteMany).toHaveBeenCalledWith({
      where: { garageId: GARAGE, id: { in: [B.id] } },
    });
    expect(entriesOf(h)).toEqual([
      expect.objectContaining({
        action: 'delete',
        oldValue: { caption: 'Hala', position: 2 },
        subjectId: B.id,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'position',
        newValue: { caption: null, position: 2 },
        oldValue: { caption: null, position: 3 },
        subjectId: C.id,
      }),
    ]);
    expect(h.storage.deleteWithCopies).toHaveBeenCalledWith(B.fileKey);
    const committed = h.prisma.$transaction.mock.invocationCallOrder[0];
    expect(
      h.storage.deleteWithCopies.mock.invocationCallOrder[0],
    ).toBeGreaterThan(committed);
  });

  it('adds D with its key, sizes, variant path, ThumbHash and caption, and a create entry', async () => {
    const h = harness();

    await h.save({
      photos: [...same, { caption: '  Rampa nouă ', key: upload(4) }],
      version: '4',
    });

    expect(h.tx.garagePhoto.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            caption: 'Rampa nouă',
            fileKey: upload(4),
            garageId: GARAGE,
            height: 600,
            position: 3,
            thumbhash: 'th',
            variantPath: `g/${GARAGE}/digest`,
            width: 800,
          },
        ],
      }),
    );
    expect(entriesOf(h)).toEqual([
      expect.objectContaining({
        action: 'create',
        newValue: { caption: 'Rampa nouă', position: 4 },
        subjectId: uuid(100),
      }),
    ]);
  });

  it('writes a caption change as an update on caption, and a photo changed in both as two entries', async () => {
    const h = harness();

    await h.save({
      photos: [kept(B, 'Hala mare'), kept(A, 'Intrarea'), kept(C)],
      version: '4',
    });

    expect(entriesOf(h)).toEqual([
      expect.objectContaining({
        action: 'update',
        field: 'caption',
        newValue: { caption: 'Intrarea', position: 2 },
        oldValue: { caption: null, position: 1 },
        subjectId: A.id,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'position',
        newValue: { caption: 'Intrarea', position: 2 },
        oldValue: { caption: null, position: 1 },
        subjectId: A.id,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'caption',
        newValue: { caption: 'Hala mare', position: 1 },
        oldValue: { caption: 'Hala', position: 2 },
        subjectId: B.id,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'position',
        newValue: { caption: 'Hala mare', position: 1 },
        oldValue: { caption: 'Hala', position: 2 },
        subjectId: B.id,
      }),
    ]);
  });

  it('clears a caption sent empty', async () => {
    const h = harness();

    await h.save({ photos: [kept(A), kept(B, '  '), kept(C)], version: '4' });

    expect(entriesOf(h)).toEqual([
      expect.objectContaining({
        field: 'caption',
        newValue: { caption: null, position: 2 },
        oldValue: { caption: 'Hala', position: 2 },
        subjectId: B.id,
      }),
    ]);
  });

  it('records the owner as the actor and never a key, path or address', async () => {
    const h = harness();

    await h.save({
      photos: [{ key: upload(4) }, kept(C), kept(A, 'x')],
      version: '4',
    });

    const entries = entriesOf(h);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorId: 'owner-1',
        garageId: GARAGE,
        subjectType: 'garage_photo',
      });
    }
    const written = JSON.stringify(entries);
    expect(written).not.toMatch(/garage_photo\//);
    expect(written).not.toMatch(/g\/|https?:/);
  });

  it('writes nothing for a save that changes nothing, and answers the same stamp', async () => {
    const h = harness();

    const answer = await h.save({ photos: same, version: '4' });

    expect(answer).toBe(h.answer);
    nothingWritten(h);
  });

  it('logs a removed file storage cannot delete, with the garage id, and still answers', async () => {
    const h = harness();
    h.storage.deleteWithCopies.mockRejectedValue(new Error('storage down'));
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const answer = await h.save({ photos: [kept(A)], version: '4' });

    expect(answer).toBe(h.answer);
    expect(h.storage.deleteWithCopies).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(GARAGE));
    logged.mockRestore();
  });
});
