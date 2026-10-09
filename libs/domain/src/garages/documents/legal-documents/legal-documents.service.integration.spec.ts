import { randomUUID } from 'node:crypto';

import type { ListingDraftData } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { LegalDocumentsService } from './legal-documents.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageService } from '../../../storage/storage.service';

// @traces 206-FR-012
// @traces 206-FR-013
// @traces 206-FR-014
// @traces 206-FR-017

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const opened = (kind: string) =>
  counterTotal(reader, 'motorfix_documents_opened_total', { kind });

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const DECLARED_AT = '2026-10-08T09:30:00.000Z';

const store = new S3TestStore();
let storage: StorageService;
let service: LegalDocumentsService;

const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

let garageId: string;
let fileId: string;
let owner: Actor;
let admin: Actor;
let certificate: string[];
let authorisation: string[];

const draftData = (
  extra: Partial<ListingDraftData> = {},
): ListingDraftData => ({
  declaredAt: DECLARED_AT,
  declaredByName: 'Mihai Popescu',
  documents: {
    onrc_certificate: { issuedOn: '2026-10-01', pages: certificate },
    rar_authorisation: { pages: authorisation },
  },
  ...extra,
});

const attach = (data: ListingDraftData, actor: Actor = owner) =>
  prisma.$transaction((tx) =>
    service.attach(tx, actor, data, { garageId, id: fileId }),
  );

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return {
    body: error.getResponse() as { code?: string },
    status: error.getStatus(),
  };
};

const rows = () =>
  prisma.legalDocument.findMany({
    orderBy: { kind: 'asc' },
    where: { verificationFileId: fileId },
  });
const entries = (subjectType: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { garageId, subjectType },
  });
const events = () =>
  prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    where: { kind: 'document.uploaded' },
  });
const fileRow = () =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id: fileId } });

async function stored(count: number, body = PDF, type = 'application/pdf') {
  const keys = Array.from(
    { length: count },
    () => `legal_document/${randomUUID()}/${randomUUID()}`,
  );
  for (const key of keys) await storage.putObject(key, body, type);
  return keys;
}

beforeAll(async () => {
  await store.start();
  storage = new StorageService(store.env());
  service = new LegalDocumentsService(
    prisma,
    new AuditService(),
    outbox,
    storage,
  );
});

afterAll(async () => {
  storage.onApplicationShutdown();
  await store.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  store.objects.clear();
  const garage = await prisma.garage.create({
    data: { name: 'Service Popescu', slug: `popescu-${randomUUID()}` },
  });
  garageId = garage.id;
  owner = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: owner.accountId, garageId, role: 'owner' },
  });
  admin = person(await account('Ioana Popa', ['admin']), 'admin');
  fileId = (await prisma.verificationFile.create({ data: { garageId } })).id;
  certificate = await stored(2);
  authorisation = await stored(1, JPEG, 'image/jpeg');
});

describe('attaching the documents when the listing is sent', () => {
  it('creates one valid row per document, pages in order, with its issue date', async () => {
    const created = await attach(draftData());

    const [onrc, rar, ...more] = await rows();
    expect(more).toHaveLength(0);
    expect(onrc).toMatchObject({
      kind: 'onrc_certificate',
      pages: certificate,
      status: 'valid',
    });
    expect(onrc?.issuedOn?.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(rar).toMatchObject({
      issuedOn: null,
      kind: 'rar_authorisation',
      pages: authorisation,
      status: 'valid',
    });
    expect(created.map((each) => each.id).sort()).toEqual(
      [onrc?.id, rar?.id].sort(),
    );
  });

  it('copies the declaration onto the file with one audit entry', async () => {
    await attach(draftData());

    const file = await fileRow();
    expect(file.declaredAt?.toISOString()).toBe(DECLARED_AT);
    expect(file.declaredByName).toBe('Mihai Popescu');
    const [entry, ...more] = await entries('verification_file');
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: owner.accountId,
      field: 'declared_at',
      garageId,
      newValue: DECLARED_AT,
      subjectId: fileId,
    });
  });

  it('writes a create entry and an admin event per document', async () => {
    await attach(draftData());

    const [onrc, rar] = await rows();
    const created = await entries('legal_document');
    expect(created).toHaveLength(2);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'create',
          garageId,
          kind: 'onrc_certificate',
          newValue: {
            issuedOn: '2026-10-01',
            kind: 'onrc_certificate',
            pages: 2,
          },
          subjectId: onrc?.id,
        }),
        expect.objectContaining({
          action: 'create',
          garageId,
          kind: 'rar_authorisation',
          newValue: { kind: 'rar_authorisation', pages: 1 },
          subjectId: rar?.id,
        }),
      ]),
    );
    const sent = await events();
    expect(sent).toHaveLength(2);
    for (const row of [onrc, rar]) {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            audience: ['admin'],
            payload: { documentId: row?.id, garageId, kind: row?.kind },
            subjectId: row?.id,
          }),
        ]),
      );
    }
  });

  it('creates no row for a document the draft does not hold', async () => {
    await attach(
      draftData({
        documents: { rar_authorisation: { pages: authorisation } },
      }),
    );

    expect((await rows()).map((each) => each.kind)).toEqual([
      'rar_authorisation',
    ]);
    expect(await events()).toHaveLength(1);
  });

  it('refuses a draft without the declaration and writes nothing', async () => {
    const refused = await refusalOf(
      attach(draftData({ declaredAt: undefined })),
    );

    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('declaration_missing');
    expect(await rows()).toHaveLength(0);
    expect(await entries('legal_document')).toHaveLength(0);
    expect(await entries('verification_file')).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect((await fileRow()).declaredAt).toBeNull();
  });

  it('refuses a declaration whose name is too short', async () => {
    const refused = await refusalOf(
      attach(draftData({ declaredByName: ' M ' })),
    );

    expect(refused.body.code).toBe('declaration_missing');
    expect(await rows()).toHaveLength(0);
  });

  it("is undone with the caller's transaction", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await service.attach(tx, owner, draftData(), { garageId, id: fileId });
        throw new Error('the send failed later');
      }),
    ).rejects.toThrow('the send failed later');

    expect(await rows()).toHaveLength(0);
    expect(await entries('legal_document')).toHaveLength(0);
    expect(await entries('verification_file')).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect((await fileRow()).declaredAt).toBeNull();
  });

  it('fails a second attach for the same file', async () => {
    await attach(draftData());

    await expect(attach(draftData())).rejects.toMatchObject({ code: 'P2002' });

    expect(await rows()).toHaveLength(2);
    expect(await events()).toHaveLength(2);
    expect(await entries('verification_file')).toHaveLength(1);
  });

  it('leaves every page at its key in storage', async () => {
    await attach(draftData());

    for (const key of [...certificate, ...authorisation]) {
      expect(store.objects.has(key)).toBe(true);
    }
  });
});

describe('an admin opening a page', () => {
  let onrcId: string;
  let rarId: string;

  beforeEach(async () => {
    const created = await attach(draftData());
    onrcId = created.find((each) => each.kind === 'onrc_certificate')?.id ?? '';
    rarId = created.find((each) => each.kind === 'rar_authorisation')?.id ?? '';
  });

  const open = (actor: Actor, n: string, documentId = onrcId, id = fileId) =>
    service.pageAddress(actor, id, documentId, n);
  const opens = () =>
    prisma.activityLog.findMany({
      where: { action: 'open', garageId, subjectType: 'legal_document' },
    });

  it('answers an inline address for 5 minutes, named after the kind and page', async () => {
    const before = Date.now();
    const counted = await opened('onrc_certificate');

    const answer = await open(admin, '2');

    const url = new URL(answer.url);
    expect(url.pathname).toContain(certificate[1]);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toContain(
      'inline',
    );
    expect(url.searchParams.get('response-content-disposition')).toContain(
      'onrc_certificate-2.pdf',
    );
    const expires = Date.parse(answer.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect(await opened('onrc_certificate')).toBe(counted + 1);
  });

  it('names a photographed page after its stored type', async () => {
    const answer = await open(admin, '1', rarId);

    expect(
      new URL(answer.url).searchParams.get('response-content-disposition'),
    ).toContain('rar_authorisation-1.jpg');
  });

  it('writes one open entry with the page, the admin and the garage', async () => {
    await open(admin, '1');

    const [entry, ...more] = await opens();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      actorId: admin.accountId,
      garageId,
      kind: 'onrc_certificate',
      newValue: { page: 1 },
      subjectId: onrcId,
    });
  });

  it('reads the document in the transaction that writes its open entry', async () => {
    const outside: string[] = [];
    const watched = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === 'legalDocument') outside.push('legalDocument');
        return Reflect.get(target, property, receiver);
      },
    });
    const watchedService = new LegalDocumentsService(
      watched,
      new AuditService(),
      outbox,
      storage,
    );

    await watchedService.pageAddress(admin, fileId, onrcId, '1');

    expect(outside).toEqual([]);
    expect(await opens()).toHaveLength(1);
  });

  it.each(['garage', 'receptionist', 'mechanic'] as const)(
    "refuses the garage's own %s with 403 not_admin and issues nothing",
    async (role) => {
      const staff =
        role === 'garage'
          ? owner
          : person(await account(role, [role]), role, garageId);
      const counted = await opened('onrc_certificate');

      const refused = await refusalOf(open(staff, '1'));

      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('not_admin');
      expect(await opens()).toHaveLength(0);
      expect(await opened('onrc_certificate')).toBe(counted);
    },
  );

  it("answers 404 to a driver and to another garage's owner", async () => {
    const other = await prisma.garage.create({
      data: { name: 'Alt service', slug: `alt-${randomUUID()}` },
    });
    const driver = person(await account('Ana', ['driver']), 'driver');
    const stranger = person(
      await account('Radu', ['garage']),
      'garage',
      other.id,
    );

    for (const actor of [driver, stranger]) {
      expect((await refusalOf(open(actor, '1'))).status).toBe(404);
    }
    expect(await opens()).toHaveLength(0);
  });

  it('answers 404 for a page gone from storage, with no entry and no address', async () => {
    store.objects.delete(certificate[0]);
    const counted = await opened('onrc_certificate');

    expect((await refusalOf(open(admin, '1'))).status).toBe(404);
    expect(await opens()).toHaveLength(0);
    expect(await opened('onrc_certificate')).toBe(counted);
  });

  it.each([
    ['an unknown file', () => open(admin, '1', onrcId, randomUUID())],
    ['a malformed file id', () => open(admin, '1', onrcId, 'not-a-uuid')],
    ['an unknown document', () => open(admin, '1', randomUUID())],
    ['page 0', () => open(admin, '0')],
    ['a page above the count', () => open(admin, '3')],
    ['a page that is not a number', () => open(admin, '1.5')],
  ])('answers 404 for %s with no address issued', async (_, call) => {
    const counted = await opened('onrc_certificate');

    expect((await refusalOf(call())).status).toBe(404);
    expect(await opens()).toHaveLength(0);
    expect(await opened('onrc_certificate')).toBe(counted);
  });
});
