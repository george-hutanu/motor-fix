import { OwnerPhotosService } from './owner-photos.service';
import type { Actor } from '../../../auth/policy';

// @traces 1249-FR-001 1249-FR-002 1249-FR-003 1249-FR-004 1249-FR-008

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const OTHER = '0f6a3c1e-1d7b-4b8e-8f5a-2c9d4e6b7a10';
const ID = '5e0a8f3b-91c2-4d7e-8b6a-000000000009';
const FINAL = `garage_photo/${GARAGE}/${ID}`;
const INCOMING = `incoming/${FINAL}`;

const actor = (role: Actor['role'] = 'garage', garageId = GARAGE) =>
  ({
    accountId: 'owner-1',
    garageId,
    permissions: {},
    role,
    roles: [role],
  }) as unknown as Actor;

function harness({ rows = 3, status = 'approved', inGallery = false } = {}) {
  const prisma = {
    garage: {
      findUnique: jest.fn(async () => ({ profileVersion: 7, status })),
    },
    garagePhoto: {
      count: jest.fn(async () => rows),
      findMany: jest.fn(async () => [
        {
          caption: 'Hala',
          fileKey: FINAL,
          height: 600,
          id: ID,
          position: 0,
          width: 800,
        },
      ]),
      findUnique: jest.fn(async () => (inGallery ? { id: ID } : null)),
    },
  };
  const storage = {
    confirmUpload: jest.fn(async () => FINAL),
    createDownloadUrl: jest.fn(async () => 'https://signed/thumb'),
    createUpload: jest.fn(async () => ({ key: INCOMING, url: 'https://up' })),
    deleteWithCopies: jest.fn(async () => undefined),
    derivedKey: jest.fn((key: string, copy: string) => `${copy}/${key}`),
    metadataOf: jest.fn(
      async (): Promise<Record<string, string> | null> => null,
    ),
  };
  const photos = {
    describe: jest.fn(async (keys: string[]) => keys.map((key) => ({ key }))),
    queue: jest.fn(async () => undefined),
  };
  const limits = { take: jest.fn(async () => undefined) };
  const service = new OwnerPhotosService(
    prisma as never,
    storage as never,
    photos as never,
    limits as never,
  );
  return { limits, photos, prisma, service, storage };
}

type Refused = { getStatus(): number; getResponse(): { code: string } };
const refused = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => {
      throw new Error('not refused');
    },
    (e: unknown) => e,
  )) as Refused;
  return { status: error.getStatus(), ...error.getResponse() };
};

const FILE = { checksum: 'AAAAAA==', contentType: 'image/jpeg', size: 1000 };

describe("the owner's upload address", () => {
  it('signs an upload under the garage, rate limited by the garage', async () => {
    const h = harness();

    await h.service.uploadAddress(actor(), GARAGE, FILE);

    expect(h.limits.take).toHaveBeenCalledWith('uploadUrl', GARAGE);
    expect(h.storage.createUpload).toHaveBeenCalledWith(
      'garage_photo',
      GARAGE,
      'image/jpeg',
      1000,
      'AAAAAA==',
    );
  });

  it('refuses a 21st photo of the gallery', async () => {
    const h = harness({ rows: 20 });

    const r = await refused(h.service.uploadAddress(actor(), GARAGE, FILE));

    expect(r).toMatchObject({ code: 'photos_full', status: 422 });
    expect(h.storage.createUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['receptionist', GARAGE, 403],
    ['mechanic', GARAGE, 403],
    ['garage', OTHER, 404],
  ] as const)(
    'refuses the %s of %s with %i',
    async (role, garageId, status) => {
      const h = harness();

      const r = await refused(
        h.service.uploadAddress(actor(role, garageId), GARAGE, FILE),
      );

      expect(r.status).toBe(status);
      expect(h.storage.createUpload).not.toHaveBeenCalled();
    },
  );

  it('answers 410 for a suspended garage and 404 for one not yet approved', async () => {
    expect(
      await refused(
        harness({ status: 'suspended' }).service.uploadAddress(
          actor(),
          GARAGE,
          FILE,
        ),
      ),
    ).toMatchObject({ code: 'gone', status: 410 });
    expect(
      await refused(
        harness({ status: 'draft' }).service.uploadAddress(
          actor(),
          GARAGE,
          FILE,
        ),
      ),
    ).toMatchObject({ code: 'not_found', status: 404 });
  });
});

describe("the owner's confirm", () => {
  it('keeps the upload under the garage and queues its copies', async () => {
    const h = harness();

    const answer = await h.service.confirm(actor(), GARAGE, INCOMING);

    expect(answer).toEqual({ key: FINAL, processed: false });
    expect(h.storage.confirmUpload).toHaveBeenCalledWith(
      INCOMING,
      'garage_photo',
      GARAGE,
    );
    expect(h.photos.queue).toHaveBeenCalledWith(FINAL);
  });

  it.each([
    ['another garage', `incoming/garage_photo/${OTHER}/${ID}`],
    ['a draft photo', `incoming/garage_photo/${ID}/${ID}`],
    ['a document', `incoming/legal_document/${GARAGE}/${ID}`],
    ['a kept file', FINAL],
  ])('answers 404 for a key of %s, before storage', async (_, key) => {
    const h = harness();

    const r = await refused(h.service.confirm(actor(), GARAGE, key));

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
    expect(h.storage.confirmUpload).not.toHaveBeenCalled();
  });

  it('answers the same photo for a key confirmed before, queueing nothing', async () => {
    const h = harness();
    h.storage.metadataOf.mockResolvedValue({});

    const answer = await h.service.confirm(actor(), GARAGE, INCOMING);

    expect(answer).toEqual({ key: FINAL, processed: false });
    expect(h.storage.confirmUpload).not.toHaveBeenCalled();
    expect(h.photos.queue).not.toHaveBeenCalled();
  });
});

describe("the owner's unsaved upload", () => {
  it('reads its copies as they are made', async () => {
    const h = harness();
    h.storage.metadataOf.mockResolvedValue({});
    h.photos.describe.mockResolvedValue([
      { height: 600, key: FINAL, width: 800 } as never,
    ]);

    const read = await h.service.upload(actor(), GARAGE, ID);

    expect(read).toEqual({
      height: 600,
      key: FINAL,
      processed: true,
      thumbnailUrl: 'https://signed/thumb',
      width: 800,
    });
  });

  // @traces 1249-FR-008
  it('answers 404 for a garage not yet approved, holding nothing back', async () => {
    const h = harness({ status: 'draft' });
    h.storage.metadataOf.mockResolvedValue({});

    const r = await refused(h.service.upload(actor(), GARAGE, ID));

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
    expect(h.storage.metadataOf).not.toHaveBeenCalled();
  });

  it('answers 404 for an upload storage does not hold', async () => {
    const h = harness();

    const r = await refused(h.service.upload(actor(), GARAGE, ID));

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('deletes an unsaved upload with its copies', async () => {
    const h = harness();
    h.storage.metadataOf.mockResolvedValue({});

    await h.service.removeUpload(actor(), GARAGE, ID);

    expect(h.storage.deleteWithCopies).toHaveBeenCalledWith(FINAL);
  });

  it('refuses to delete a photo the gallery holds, deleting nothing', async () => {
    const h = harness({ inGallery: true });
    h.storage.metadataOf.mockResolvedValue({});

    const r = await refused(h.service.removeUpload(actor(), GARAGE, ID));

    expect(r).toMatchObject({ code: 'photo_in_gallery', status: 409 });
    expect(h.storage.deleteWithCopies).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown upload', async () => {
    const h = harness();

    const r = await refused(h.service.removeUpload(actor(), GARAGE, ID));

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
    expect(h.storage.deleteWithCopies).not.toHaveBeenCalled();
  });
});

describe("the owner's gallery read", () => {
  it('answers the stamp and the photos in order with signed thumbnails and no key', async () => {
    const h = harness();

    const read = await h.service.list(actor(), GARAGE);

    expect(read).toEqual({
      photos: [
        {
          caption: 'Hala',
          height: 600,
          id: ID,
          position: 0,
          processed: true,
          thumbnailUrl: 'https://signed/thumb',
          width: 800,
        },
      ],
      version: '7',
    });
    expect(JSON.stringify(read)).not.toContain('garage_photo/');
  });

  it.each([
    ['receptionist', GARAGE, 403],
    ['mechanic', GARAGE, 403],
    ['garage', OTHER, 404],
  ] as const)(
    'refuses the %s of %s with %i',
    async (role, garageId, status) => {
      const h = harness();

      const r = await refused(h.service.list(actor(role, garageId), GARAGE));

      expect(r.status).toBe(status);
    },
  );
});
