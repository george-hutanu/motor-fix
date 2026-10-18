import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

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

// @traces 302-FR-001 302-FR-010

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const storage = {
  createDownloadUrl: async (key: string) => `https://store.test/${key}`,
  derivedKey: (key: string, copy: string) => `${key}.${copy}`,
  metadataOf: async () => null,
  ready: jest.fn(async () => undefined),
};

const service = () =>
  new VerificationFileService(
    prisma,
    storage as unknown as StorageService,
    new PublicGaragesService(
      prisma,
      {} as CacheService,
      storage as unknown as StorageService,
    ),
  );

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  return 200;
}

const brand = (name: string) =>
  prisma.brand.upsert({
    create: { key: `test-${name}`, name, slug: `test-${name}` },
    update: {},
    where: { name },
  });

const SENT = new Date('2026-10-15T10:00:00+03:00');

let ioana: string;
let garageId: string;

// A file sent at SENT, with its 8 checks, as a submission leaves it.
async function sent(
  data: Partial<Prisma.VerificationFileUncheckedCreateInput> = {},
) {
  const file = await prisma.verificationFile.create({
    data: { garageId, status: 'submitted', submittedAt: SENT, ...data },
  });
  await prisma.$executeRaw`INSERT INTO verification_check (id, file_id, kind)
    SELECT gen_random_uuid(), ${file.id}::uuid, k
    FROM unnest(enum_range(NULL::verification_check_kind)) AS k`;
  return file;
}

beforeEach(async () => {
  await reset();
  storage.ready.mockClear();
  storage.ready.mockResolvedValue(undefined);
  ioana = await account('Ioana Popa', ['admin']);
  const garage = await prisma.garage.create({
    data: {
      address: 'Strada Fabricii 12, Cluj-Napoca',
      businessKind: 'company',
      name: 'Atelier Dinamo',
      phone: '+40722111222',
      slug: `dinamo-${randomUUID()}`,
    },
  });
  garageId = garage.id;
  await prisma.$executeRaw`UPDATE garage SET cui = '12345678' WHERE id = ${garageId}::uuid`;
});

afterAll(() => prisma.$disconnect());

describe('reading a file', () => {
  it("carries a company's header, its brands by name and its photos", async () => {
    const [dacia, audi, bmw] = await Promise.all(
      ['Dacia', 'Audi', 'BMW'].map(brand),
    );
    await prisma.garageBrand.createMany({
      data: [
        { brandId: dacia.id, garageId, stance: 'works_on' },
        { brandId: audi.id, garageId, stance: 'works_on' },
        {
          brandId: bmw.id,
          diesel: false,
          electric: false,
          garageId,
          hybrid: false,
          petrol: false,
          stance: 'does_not_take',
        },
      ],
    });
    await prisma.garagePhoto.create({
      data: {
        fileKey: `garage_photo/${garageId}/a`,
        garageId,
        height: 600,
        position: 0,
        width: 800,
      },
    });
    const file = await sent();

    const read = await service().read(file.id);

    expect(read.garage).toEqual({
      address: 'Strada Fabricii 12, Cluj-Napoca',
      brands: ['Audi', 'Dacia'],
      businessKind: 'company',
      cui: '12345678',
      cuiAlsoUsedBy: [],
      id: garageId,
      name: 'Atelier Dinamo',
      phone: '+40722111222',
      photos: [
        {
          displayUrl: `https://store.test/garage_photo/${garageId}/a.display`,
          height: 600,
          id: expect.any(String),
          thumbnailUrl: `https://store.test/garage_photo/${garageId}/a.thumb`,
          width: 800,
        },
      ],
      seatAddress: null,
      serviceRadiusKm: null,
    });
    expect(read.file).toMatchObject({
      id: file.id,
      openedBy: null,
      status: 'submitted',
      submittedAt: SENT.toISOString(),
    });
  });

  it("carries a mobile mechanic's seat and radius, with no workshop address", async () => {
    await prisma.garage.update({
      data: {
        address: null,
        businessKind: 'mobile',
        seatAddress: 'Strada Lungă 3, Brașov',
        serviceRadiusKm: 25,
      },
      where: { id: garageId },
    });
    const file = await sent();

    const { garage } = await service().read(file.id);

    expect(garage).toMatchObject({
      address: null,
      businessKind: 'mobile',
      seatAddress: 'Strada Lungă 3, Brașov',
      serviceRadiusKm: 25,
    });
  });

  it('lists the 8 checks in order, with the activities by name', async () => {
    await prisma.garage.update({
      data: { rarActivities: ['brakes', 'mechanics'] },
      where: { id: garageId },
    });
    const file = await sent();

    const read = await service().read(file.id);

    expect(read.checks.map((c) => c.kind)).toEqual([
      'company',
      'caen',
      'rar',
      'activities',
      'representative',
      'address',
      'photos',
      'documents',
    ]);
    expect(read.checks.every((c) => c.result === 'not_run')).toBe(true);
    expect(read.activities).toEqual([
      { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
      { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
    ]);
  });

  it('lists one entry per document kind, with the certificate judged against the sending', async () => {
    const file = await sent();
    const certificate = await prisma.legalDocument.create({
      data: {
        issuedOn: new Date('2026-09-01'),
        kind: 'onrc_certificate',
        pages: ['a', 'b'],
        verificationFileId: file.id,
      },
    });

    const { documents } = await service().read(file.id);

    expect(documents).toEqual([
      {
        id: certificate.id,
        issuedOn: '2026-09-01',
        kind: 'onrc_certificate',
        pages: 2,
        present: true,
        stale: true,
      },
      {
        id: null,
        issuedOn: null,
        kind: 'rar_authorisation',
        pages: 0,
        present: false,
        stale: null,
      },
    ]);
  });

  it.each([
    ['issued 6 days before the sending', '2026-10-09', false],
    ['issued 30 days before', '2026-09-15', false],
    ['issued 31 days before', '2026-09-14', true],
    ['with no issue date', null, true],
  ])('marks a certificate %s', async (_, issuedOn, stale) => {
    const file = await sent();
    await prisma.legalDocument.create({
      data: {
        issuedOn: issuedOn ? new Date(issuedOn) : null,
        kind: 'onrc_certificate',
        pages: ['a'],
        verificationFileId: file.id,
      },
    });
    await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['r'],
        verificationFileId: file.id,
      },
    });

    const { documents } = await service().read(file.id);

    expect(documents.map((d) => d.stale)).toEqual([stale, null]);
  });

  it('carries the open reports, newest first, and the earlier rejection', async () => {
    const reporters = [
      await account('Radu', ['driver']),
      await account('Elena', ['driver']),
    ];
    const rejected = await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-10-01T12:00:00Z'),
        decidedBy: ioana,
        garageId,
        reasonCode: 'documents_unreadable',
        reasonNote: 'CUI neclar',
        status: 'rejected',
      },
    });
    const file = await sent({
      previousFileId: rejected.id,
      reopenReason: 'garage_report',
    });
    for (const [text, at] of [
      ['Prețurile afișate sunt false', '2026-10-10T08:00:00Z'],
      ['<b>Închis</b> mereu la ora afișată', '2026-10-12T08:00:00Z'],
    ]) {
      await prisma.garageReport.create({
        data: {
          createdAt: new Date(at),
          garageId,
          reporterId: reporters.pop() ?? '',
          text,
          verificationFileId: file.id,
        },
      });
    }

    const read = await service().read(file.id);

    expect(read.reports).toEqual([
      {
        createdAt: '2026-10-12T08:00:00.000Z',
        text: '<b>Închis</b> mereu la ora afișată',
      },
      {
        createdAt: '2026-10-10T08:00:00.000Z',
        text: 'Prețurile afișate sunt false',
      },
    ]);
    expect(read.previousRejection).toEqual({
      decidedAt: '2026-10-01T12:00:00.000Z',
      reasonCode: 'documents_unreadable',
      reasonNote: 'CUI neclar',
    });
    expect(read.file.reopenReason).toBe('garage_report');
  });

  it('carries no earlier rejection when the file before was not rejected', async () => {
    const asked = await prisma.verificationFile.create({
      data: { decidedAt: new Date(), garageId, status: 'more_requested' },
    });
    const file = await sent({ previousFileId: asked.id });

    expect((await service().read(file.id)).previousRejection).toBeNull();
  });

  // @traces 305-FR-008
  it('carries the latest rejection of a garage rejected twice, leaving the earlier files as they were', async () => {
    const first = await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-09-01T09:00:00Z'),
        decidedBy: ioana,
        garageId,
        reasonCode: 'documents',
        reasonNote: 'Certificatul ONRC lipsește.',
        status: 'rejected',
      },
    });
    const second = await prisma.verificationFile.create({
      data: {
        decidedAt: new Date('2026-10-02T15:30:00Z'),
        decidedBy: ioana,
        garageId,
        previousFileId: first.id,
        reasonCode: 'rar',
        reasonNote: 'Autorizația RAR a expirat.',
        status: 'rejected',
      },
    });
    const file = await sent({ previousFileId: second.id });

    expect((await service().read(file.id)).previousRejection).toEqual({
      decidedAt: '2026-10-02T15:30:00.000Z',
      reasonCode: 'rar',
      reasonNote: 'Autorizația RAR a expirat.',
    });
    expect(
      await prisma.verificationFile.findUniqueOrThrow({
        where: { id: second.id },
      }),
    ).toMatchObject({ reasonCode: 'rar', status: 'rejected' });
    expect(await prisma.garage.count({ where: { id: garageId } })).toBe(1);
  });

  it("names each check's recorder, MotorFix for an automatic one and nobody for one never recorded", async () => {
    const file = await sent();
    const at = new Date();
    await prisma.verificationCheck.updateMany({
      data: { recordedAt: at, recordedBy: ioana, result: 'ok' },
      where: { fileId: file.id, kind: 'address' },
    });
    await prisma.verificationCheck.updateMany({
      data: { automatic: true, recordedAt: at, recordedBy: null, result: 'ok' },
      where: { fileId: file.id, kind: 'company' },
    });

    const read = await service().read(file.id);
    const recorder = (kind: string) =>
      read.checks.find((c) => c.kind === kind)?.recorder;

    expect(recorder('address')).toEqual({ id: ioana, name: 'Ioana' });
    expect(recorder('company')).toEqual({ id: null, name: 'MotorFix' });
    expect(recorder('photos')).toBeNull();
  });

  it('names who opened and who decided, MotorFix for the system', async () => {
    const file = await sent({
      decidedAt: new Date(),
      decidedBy: null,
      openedAt: new Date(),
      openedBy: ioana,
      status: 'approved',
    });

    const read = await service().read(file.id);

    expect(read.file.openedBy).toEqual({ id: ioana, name: 'Ioana' });
    expect(read.file.decidedBy).toEqual({ id: null, name: 'MotorFix' });
  });

  it('says the store is down without failing the read', async () => {
    storage.ready.mockRejectedValue(new Error('timeout'));
    const file = await sent();

    const read = await service().read(file.id);

    expect(read.storageReady).toBe(false);
    expect(read.checks).toHaveLength(8);
  });

  it.each([
    ['an unknown id', () => randomUUID()],
    ['a malformed id', () => "x'; drop table--"],
  ])('answers 404 for %s', async (_, id) => {
    expect(await statusOf(service().read(id()))).toBe(404);
  });
});

describe('the timeline', () => {
  const entry = (
    data: Partial<Prisma.ActivityLogUncheckedCreateInput> & {
      subjectId: string;
      subjectType: string;
    },
    minute: number,
  ) =>
    prisma.activityLog.create({
      data: {
        action: 'update',
        actorId: ioana,
        actorName: 'Ioana',
        actorRole: 'admin',
        at: new Date(SENT.getTime() + minute * 60_000),
        garageId,
        ...data,
      },
    });

  it('lists the sending, the opening, a check, a document opening, a decision and a reopening, newest first', async () => {
    const file = await sent();
    const check = await prisma.verificationCheck.findFirstOrThrow({
      where: { fileId: file.id, kind: 'photos' },
    });
    const document = await prisma.legalDocument.create({
      data: {
        kind: 'onrc_certificate',
        pages: ['a'],
        verificationFileId: file.id,
      },
    });
    const owner = { actorName: 'Mihai', actorRole: 'owner' as const };
    await entry(
      {
        action: 'create',
        newValue: 'submitted',
        subjectId: file.id,
        subjectType: 'verification_file',
        ...owner,
      },
      0,
    );
    await entry(
      {
        field: 'status',
        newValue: 'in_review',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      1,
    );
    await entry(
      {
        field: 'photos',
        kind: 'verification_check_recorded',
        newValue: { result: 'ok' },
        subjectId: check.id,
        subjectType: 'verification_check',
      },
      2,
    );
    await entry(
      {
        action: 'open',
        kind: 'onrc_certificate',
        newValue: { page: 1 },
        subjectId: document.id,
        subjectType: 'legal_document',
      },
      3,
    );
    await entry(
      {
        field: 'status',
        newValue: 'approved',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      4,
    );
    await entry(
      {
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
        field: 'status',
        newValue: 'in_review',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      5,
    );
    // The owner's resending after the decision.
    await entry(
      {
        field: 'status',
        kind: 'verification_resent',
        newValue: 'submitted',
        subjectId: file.id,
        subjectType: 'verification_file',
        ...owner,
      },
      6,
    );

    const { timeline } = await service().read(file.id);

    expect(timeline.total).toBe(7);
    expect(
      timeline.entries.map((e) => [e.subjectType, e.action, e.newValue]),
    ).toEqual([
      ['verification_file', 'update', 'submitted'],
      ['verification_file', 'update', 'in_review'],
      ['verification_file', 'update', 'approved'],
      ['legal_document', 'open', { page: 1 }],
      ['verification_check', 'update', { result: 'ok' }],
      ['verification_file', 'update', 'in_review'],
      ['verification_file', 'create', 'submitted'],
    ]);
    expect(timeline.entries[0]).toMatchObject({
      actor: { name: 'Mihai', role: 'owner' },
      kind: 'verification_resent',
    });
    expect(timeline.entries[1]?.actor).toEqual({
      id: null,
      name: 'MotorFix',
      role: 'system',
    });
  });

  it("leaves out a document upload, the declaration, another file's lines and the garage's other changes", async () => {
    const file = await sent();
    const other = await prisma.verificationFile.create({
      data: { garageId, status: 'rejected' },
    });
    const document = await prisma.legalDocument.create({
      data: {
        kind: 'onrc_certificate',
        pages: ['a'],
        verificationFileId: file.id,
      },
    });
    await entry(
      {
        action: 'create',
        subjectId: document.id,
        subjectType: 'legal_document',
      },
      0,
    );
    await entry(
      {
        field: 'declared_at',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      1,
    );
    await entry(
      {
        field: 'status',
        newValue: 'rejected',
        subjectId: other.id,
        subjectType: 'verification_file',
      },
      2,
    );
    await entry(
      { field: 'phone', subjectId: garageId, subjectType: 'garage' },
      3,
    );
    await entry(
      {
        field: 'status',
        newValue: 'in_review',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      4,
    );

    const { timeline } = await service().read(file.id);

    expect(timeline.total).toBe(1);
    expect(timeline.entries.map((e) => e.newValue)).toEqual(['in_review']);
  });

  // @traces 259-FR-006
  it('carries a refused approval, newest first, and counts it', async () => {
    const file = await sent();
    await entry(
      {
        field: 'status',
        newValue: 'in_review',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      1,
    );
    await entry(
      {
        field: 'decision',
        kind: 'verification_approval_refused',
        newValue: 'rar_check_required',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
      2,
    );

    const { timeline } = await service().read(file.id);

    expect(timeline.total).toBe(2);
    expect(timeline.entries[0]).toMatchObject({
      actor: { name: 'Ioana', role: 'admin' },
      field: 'decision',
      kind: 'verification_approval_refused',
      newValue: 'rar_check_required',
    });
  });

  it('keeps the newest 50 and counts them all', async () => {
    const file = await sent();
    const check = await prisma.verificationCheck.findFirstOrThrow({
      where: { fileId: file.id, kind: 'address' },
    });
    for (let minute = 0; minute < 53; minute += 1) {
      await entry(
        {
          field: 'address',
          newValue: { minute },
          subjectId: check.id,
          subjectType: 'verification_check',
        },
        minute,
      );
    }

    const { timeline } = await service().read(file.id);

    expect(timeline.total).toBe(53);
    expect(timeline.entries).toHaveLength(50);
    expect(timeline.entries[0]?.newValue).toEqual({ minute: 52 });
    expect(timeline.entries[49]?.newValue).toEqual({ minute: 3 });
  });

  it('writes nothing when read', async () => {
    const file = await sent();
    const before = await prisma.activityLog.count();

    await service().read(file.id);

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

// @traces 204-FR-001
// @traces 204-FR-009
describe('what the RAR forms compare', () => {
  const priced = async (
    key: string,
    rarActivity: string | null,
    position: number,
    brandId: string | null = null,
  ) => {
    const job =
      (await prisma.jobType.findFirst({ where: { nameEn: key } })) ??
      (await prisma.jobType.create({
        data: {
          key: `${key}-${randomUUID()}`,
          nameEn: key,
          nameRo: `${key} ro`,
          rarActivity,
          status: 'approved',
        },
      }));
    await prisma.garagePrice.create({
      data: {
        brandId,
        fromBani: 10_000,
        garageId,
        jobTypeId: job.id,
        position,
        updatedBy: ioana,
      },
    });
    return job.id;
  };

  it('carries the RAR number as stored, or none', async () => {
    const file = await sent({ rarNumber: 'B 1234/2019' });
    expect((await service().read(file.id)).file.rarNumber).toBe('B 1234/2019');

    await prisma.verificationFile.update({
      data: { rarNumber: null },
      where: { id: file.id },
    });
    expect((await service().read(file.id)).file.rarNumber).toBeNull();
  });

  it('carries the whole activity catalogue by code', async () => {
    const file = await sent();

    const { catalogue } = await service().read(file.id);

    expect(catalogue.map((a) => a.code)).toEqual([
      'air_con',
      'brakes',
      'mechanics',
      'steering',
      'suspension',
    ]);
    expect(catalogue[1]).toEqual({
      code: 'brakes',
      nameEn: 'Brakes',
      nameRo: 'Frâne',
    });
  });

  it("carries the price list's jobs once each, in the list's order, with their activity", async () => {
    const audi = await brand('Audi');
    const paint = await priced('Paint', 'paintwork', 1);
    const brakes = await priced('Brakes', 'brakes', 0);
    await priced('Brakes', 'brakes', 2, audi.id);
    const file = await sent();

    const { jobs } = await service().read(file.id);

    expect(jobs).toEqual([
      {
        jobTypeId: brakes,
        nameEn: 'Brakes',
        nameRo: 'Brakes ro',
        rarActivity: 'brakes',
      },
      {
        jobTypeId: paint,
        nameEn: 'Paint',
        nameRo: 'Paint ro',
        rarActivity: 'paintwork',
      },
    ]);
  });

  it('shows a RAR number correction in the timeline', async () => {
    const file = await sent();
    await prisma.activityLog.create({
      data: {
        action: 'update',
        actorId: ioana,
        actorName: 'Ioana',
        actorRole: 'admin',
        field: 'rar_number',
        garageId,
        newValue: 'B 1234/2019',
        subjectId: file.id,
        subjectType: 'verification_file',
      },
    });

    const { timeline } = await service().read(file.id);

    expect(timeline.entries.map((e) => e.field)).toContain('rar_number');
  });
});

// @traces 204-FR-012
describe('a file decided before the checks existed', () => {
  it('reads its eight checks not run and its decision unchanged', async () => {
    const file = await sent({
      decidedAt: SENT,
      decidedBy: ioana,
      status: 'approved',
    });

    const read = await service().read(file.id);

    expect(read.checks).toHaveLength(8);
    expect(read.checks.every((c) => c.result === 'not_run')).toBe(true);
    expect(read.file).toMatchObject({
      decidedAt: SENT.toISOString(),
      status: 'approved',
    });
  });
});

describe('a file back after a request for more', () => {
  // @traces 304-FR-007
  const ASKED = new Date('2026-10-13T11:00:00+03:00');
  const LATER = new Date('2026-10-14T11:00:00+03:00');

  it('says so, with the time it was asked for more', async () => {
    const file = await sent({ decidedAt: ASKED });

    const { file: read } = await service().read(file.id);

    expect(read.resubmitted).toBe(true);
    expect(read.requestedAt).toBe(ASKED.toISOString());
  });

  it.each([
    ['never asked', {}],
    ['reopened after its decision', { decidedAt: ASKED, reopenedAt: LATER }],
    ['decided', { decidedAt: ASKED, status: 'approved' as const }],
    [
      'still waiting for the garage',
      { decidedAt: ASKED, status: 'more_requested' as const },
    ],
  ])('says nothing when %s', async (_, data) => {
    const file = await sent(data);

    const { file: read } = await service().read(file.id);

    expect(read.resubmitted).toBe(false);
    expect(read.requestedAt).toBeNull();
  });
});
