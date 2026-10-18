import { randomUUID } from 'node:crypto';

import { VerificationFileService } from './verification-file.service';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { CacheService } from '../../../cache/cache.service';
import type { Prisma } from '../../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import type { StorageService } from '../../../storage/storage.service';
import { PublicGaragesService } from '../../public-garages/public-garages';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const storage = {} as StorageService;
const service = () =>
  new VerificationFileService(
    prisma,
    storage,
    new PublicGaragesService(prisma, {} as CacheService, storage),
  );

const SENT = new Date('2026-10-12T10:00:00+03:00');
const ASKED = new Date('2026-10-13T11:00:00+03:00');
const minutes = (from: Date, n: number) =>
  new Date(from.getTime() + n * 60_000);

let mihai: string;
let garageId: string;

beforeEach(async () => {
  await reset();
  mihai = await account('Mihai', ['garage']);
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  garageId = garage.id;
});

afterAll(() => prisma.$disconnect());

// A file the garage sent back after the request for more of `decidedAt`.
const returned = (
  data: Partial<Prisma.VerificationFileUncheckedCreateInput> = {},
) =>
  prisma.verificationFile.create({
    data: {
      decidedAt: ASKED,
      garageId,
      status: 'submitted',
      submittedAt: minutes(ASKED, 120),
      ...data,
    },
  });

// One line of the garage's history, `minute` minutes after `from`.
const entry = (
  data: Partial<Prisma.ActivityLogUncheckedCreateInput> & {
    subjectType: string;
  },
  minute: number,
  from = ASKED,
) =>
  prisma.activityLog.create({
    data: {
      action: 'update',
      actorId: mihai,
      actorName: 'Mihai',
      actorRole: 'owner',
      at: minutes(from, minute),
      garageId,
      subjectId: garageId,
      ...data,
    },
  });

describe("a returned file's changes", () => {
  // @traces 304-FR-008
  it('lists what the garage changed after the request, newest first, by area', async () => {
    const file = await returned();
    const document = randomUUID();
    await entry(
      { field: 'phone', newValue: '+40722000000', subjectType: 'garage' },
      -5,
    );
    await entry(
      {
        field: 'phone',
        newValue: '+40722333444',
        oldValue: '+40722111222',
        subjectType: 'garage',
      },
      1,
    );
    await entry(
      {
        action: 'create',
        subjectId: randomUUID(),
        subjectType: 'garage_facility',
      },
      2,
    );
    await entry(
      {
        action: 'delete',
        subjectId: randomUUID(),
        subjectType: 'garage_closed_day',
      },
      3,
    );
    await entry(
      {
        field: 'labour_bani',
        newValue: 25_000,
        oldValue: 20_000,
        subjectId: randomUUID(),
        subjectType: 'garage_price',
      },
      4,
    );
    await entry(
      {
        action: 'create',
        subjectId: randomUUID(),
        subjectType: 'garage_brand_job',
      },
      5,
    );
    await entry(
      {
        action: 'create',
        subjectId: randomUUID(),
        subjectType: 'garage_brand',
      },
      6,
    );
    await entry(
      {
        action: 'delete',
        subjectId: randomUUID(),
        subjectType: 'garage_photo',
      },
      7,
    );
    await entry(
      {
        action: 'create',
        kind: 'rar_authorisation',
        subjectId: document,
        subjectType: 'legal_document',
      },
      8,
    );

    const read = await service().changes(file.id);

    expect(read.resubmitted).toBe(true);
    expect(read.requestedAt).toBe(ASKED.toISOString());
    expect(read.total).toBe(8);
    expect(read.changes.map((c) => [c.area, c.subjectType])).toEqual([
      ['documents', 'legal_document'],
      ['photos', 'garage_photo'],
      ['brands', 'garage_brand'],
      ['prices', 'garage_brand_job'],
      ['prices', 'garage_price'],
      ['profile', 'garage_closed_day'],
      ['profile', 'garage_facility'],
      ['profile', 'garage'],
    ]);
    expect(read.changes[0]).toEqual({
      action: 'create',
      area: 'documents',
      at: minutes(ASKED, 8).toISOString(),
      field: null,
      kind: 'rar_authorisation',
      newValue: null,
      oldValue: null,
      subjectType: 'legal_document',
    });
    expect(read.changes[7]).toMatchObject({
      field: 'phone',
      newValue: '+40722333444',
      oldValue: '+40722111222',
    });
  });

  // @traces 304-FR-008
  it("leaves out the file's own lines, internal notes, document openings and other garages", async () => {
    const file = await returned();
    const other = await prisma.garage.create({
      data: { name: 'Auto Vest', slug: `vest-${randomUUID()}` },
    });
    await entry(
      { field: 'status', subjectId: file.id, subjectType: 'verification_file' },
      1,
    );
    await entry(
      {
        field: 'address',
        subjectId: randomUUID(),
        subjectType: 'verification_check',
      },
      2,
    );
    await entry({ field: 'phone', internal: true, subjectType: 'garage' }, 3);
    await entry(
      {
        action: 'open',
        subjectId: randomUUID(),
        subjectType: 'legal_document',
      },
      4,
    );
    await entry({ field: 'name', subjectId: mihai, subjectType: 'account' }, 5);
    await entry(
      {
        field: 'phone',
        garageId: other.id,
        subjectId: other.id,
        subjectType: 'garage',
      },
      6,
    );
    await entry({ field: 'name', subjectType: 'garage' }, 0);

    const read = await service().changes(file.id);

    expect(read).toEqual({
      changes: [],
      requestedAt: ASKED.toISOString(),
      resubmitted: true,
      total: 0,
    });
  });

  // @traces 304-FR-008
  it('keeps the newest 200 and counts them all', async () => {
    const file = await returned();
    for (let minute = 1; minute <= 203; minute += 1) {
      await entry(
        { field: 'phone', newValue: { minute }, subjectType: 'garage' },
        minute,
      );
    }

    const read = await service().changes(file.id);

    expect(read.total).toBe(203);
    expect(read.changes).toHaveLength(200);
    expect(read.changes[0]?.newValue).toEqual({ minute: 203 });
    expect(read.changes[199]?.newValue).toEqual({ minute: 4 });
  });

  // @traces 304-FR-008
  it('counts from the latest request after two', async () => {
    const LATEST = minutes(ASKED, 600);
    const file = await returned({ decidedAt: LATEST });
    await entry(
      { field: 'phone', newValue: 'first', subjectType: 'garage' },
      10,
    );
    await entry(
      { field: 'phone', newValue: 'second', subjectType: 'garage' },
      10,
      LATEST,
    );

    const read = await service().changes(file.id);

    expect(read.requestedAt).toBe(LATEST.toISOString());
    expect(read.changes.map((c) => c.newValue)).toEqual(['second']);
  });

  // @traces 304-FR-008
  it.each([
    ['never asked for more', { decidedAt: null, submittedAt: SENT }],
    ['reopened after its decision', { reopenedAt: minutes(ASKED, 60) }],
    ['decided', { status: 'approved' as const }],
  ])('is empty for a file %s', async (_, data) => {
    const file = await returned(data);
    await entry({ field: 'phone', subjectType: 'garage' }, 30);

    const read = await service().changes(file.id);

    expect(read).toEqual({
      changes: [],
      requestedAt: null,
      resubmitted: false,
      total: 0,
    });
  });

  // @traces 304-FR-008
  it.each([randomUUID(), 'not-a-file'])('answers 404 to %s', async (id) => {
    await expect(service().changes(id)).rejects.toMatchObject({
      status: 404,
    });
  });

  // @traces 304-FR-008
  it('writes nothing when read', async () => {
    const file = await returned();
    await entry({ field: 'phone', subjectType: 'garage' }, 1);
    const before = await prisma.activityLog.count();

    await service().changes(file.id);

    expect(await prisma.activityLog.count()).toBe(before);
  });
});
