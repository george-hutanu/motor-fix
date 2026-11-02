import { sweepLegalDocuments } from './legal-documents';
import { RETENTION, RETENTION_BATCH } from './retention.config';
import { ago, retentionFixtures } from './retention.testing';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl } from '../notifications/notifications.testing';

serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const data = retentionFixtures(prisma);
const now = new Date('2026-10-24T10:00:00.000Z');
const days = RETENTION.legalDocuments.days;
const outside = ago(now, days, 1);
const inside = ago(now, days, -1);

// The store as the sweep sees it: S3 answers a missing key with success.
const fakeStorage = (failing: string[] = []) => {
  const deleted: string[] = [];
  return {
    deleted,
    deleteObject: vi.fn(async (key: string) => {
      if (failing.includes(key)) throw new Error(`store down for ${key}`);
      deleted.push(key);
    }),
  };
};

const remaining = async () =>
  (await prisma.legalDocument.findMany({ select: { id: true } }))
    .map((r) => r.id)
    .sort();

afterAll(() => prisma.$disconnect());
beforeEach(() => data.reset());

// @traces 1156-FR-006
describe('the legal documents sweep', () => {
  it('removes every document of a garage closed longer than the period, pages first', async () => {
    const old = await data.garage(outside);
    const recent = await data.garage(inside);
    const open = await data.garage(null);
    const statuses = ['valid', 'in_review', 'refused'];
    for (const status of statuses) {
      await data.legalDocument(old, status, [
        `legal/${old}/${status}-1`,
        `legal/${old}/${status}-2`,
      ]);
    }
    const replaced = await data.legalDocument(old, 'valid', [
      `legal/${old}/replaced`,
    ]);
    await prisma.legalDocument.update({
      data: { replacedAt: outside },
      where: { id: replaced },
    });
    const keep = [
      await data.legalDocument(recent, 'valid', [`legal/${recent}/a`]),
      await data.legalDocument(open, 'valid', [`legal/${open}/a`]),
    ];
    const storage = fakeStorage();

    expect(await sweepLegalDocuments({ prisma, storage }, now)).toBe(
      statuses.length + 1,
    );

    expect(await remaining()).toEqual(keep.sort());
    expect(storage.deleted.sort()).toEqual(
      [
        ...statuses.flatMap((s) => [
          `legal/${old}/${s}-1`,
          `legal/${old}/${s}-2`,
        ]),
        `legal/${old}/replaced`,
      ].sort(),
    );
  });

  it('counts a page already missing from the store as removed', async () => {
    const old = await data.garage(outside);
    await data.legalDocument(old, 'valid', [`legal/${old}/gone`]);
    expect(
      await sweepLegalDocuments({ prisma, storage: fakeStorage() }, now),
    ).toBe(1);
    expect(await remaining()).toEqual([]);
  });

  it('keeps a document whose page the store could not delete, removes the rest, then fails', async () => {
    const old = await data.garage(outside);
    const stuck = await data.legalDocument(old, 'valid', [
      `legal/${old}/stuck`,
    ]);
    await data.legalDocument(old, 'refused', [`legal/${old}/fine`]);
    const storage = fakeStorage([`legal/${old}/stuck`]);

    await expect(sweepLegalDocuments({ prisma, storage }, now)).rejects.toThrow(
      `legal/${old}/stuck`,
    );
    expect(await remaining()).toEqual([stuck]);
    expect(storage.deleted).toEqual([`legal/${old}/fine`]);
    // The next night takes it once the store answers again.
    expect(
      await sweepLegalDocuments({ prisma, storage: fakeStorage() }, now),
    ).toBe(1);
  });

  it('removes nothing the second time', async () => {
    const old = await data.garage(outside);
    await data.legalDocument(old, 'valid', [`legal/${old}/a`]);
    await sweepLegalDocuments({ prisma, storage: fakeStorage() }, now);
    const storage = fakeStorage();
    expect(await sweepLegalDocuments({ prisma, storage }, now)).toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});

// @traces 1156-FR-013
describe('the legal document batches', () => {
  it('keep going until every due document is gone', async () => {
    const old = await data.garage(outside);
    const file = await prisma.verificationFile.create({
      data: { garageId: old },
    });
    const total = RETENTION_BATCH + 2;
    await prisma.$executeRaw`
      INSERT INTO legal_document (verification_file_id, kind, pages, status)
      SELECT ${file.id}::uuid, 'kind-' || n, ARRAY['legal/' || n], 'refused'
        FROM generate_series(1, ${total}) AS n`;
    const storage = fakeStorage();
    expect(await sweepLegalDocuments({ prisma, storage }, now)).toBe(total);
    expect(storage.deleted).toHaveLength(total);
    expect(await remaining()).toEqual([]);
  });
});
