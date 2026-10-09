import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';

import { ListingDocumentsController } from './listing-documents.controller';
import { ListingDocumentsService } from './listing-documents.service';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageService } from '../../../storage/storage.service';
import { NoStore } from '../../listing-drafts/listing-drafts.controller';
import { ListingDraftsService } from '../../listing-drafts/listing-drafts.service';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const uploaded = (kind: string) =>
  counterTotal(reader, 'motorfix_documents_uploaded_total', { kind });

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const MB = 1024 * 1024;
const EMAIL = 'owner@example.test';

const store = new S3TestStore();
const notifications = {
  sendToDraft: async () => undefined,
} as unknown as NotificationsService;
const drafts = new ListingDraftsService(prisma, notifications, {
  webUrl: 'https://motorfix.test',
} as never);
let storage: StorageService;
let documents: ListingDocumentsService;

beforeAll(async () => {
  await store.start();
  storage = new StorageService(store.env());
  documents = new ListingDocumentsService(prisma, drafts, storage);
});

afterAll(async () => {
  storage.onApplicationShutdown();
  await store.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  store.objects.clear();
  store.beforeDelete = undefined;
});

type Documents = Record<string, { pages: string[]; issuedOn?: string }>;

const newDraft = () =>
  drafts.create({
    data: { steps: { '1': { name: 'Service Popescu' } } },
    email: EMAIL,
    language: 'ro',
    step: 6,
  });

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

const documentsOf = async (id: string) => {
  const row = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
  return (row.data as { documents?: Documents }).documents;
};

// Pages a confirm would have added, stored as objects too.
async function holding(
  id: string,
  kind: string,
  count: number,
  issuedOn?: string,
) {
  const pages = Array.from(
    { length: count },
    () => `legal_document/${id}/${randomUUID()}`,
  );
  for (const key of pages) await storage.putObject(key, PDF, 'application/pdf');
  const row = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
  const data = row.data as { documents?: Documents };
  await prisma.listingDraft.update({
    data: {
      data: {
        ...data,
        documents: {
          ...data.documents,
          [kind]: { pages, ...(issuedOn && { issuedOn }) },
        },
      },
    },
    where: { id },
  });
  return pages;
}

async function upload(
  id: string,
  token: string,
  kind = 'onrc_certificate',
  file = PDF,
  contentType = 'application/pdf',
) {
  const address = await documents.uploadAddress(id, kind, token, {
    contentType,
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

const submit = (id: string) =>
  prisma.listingDraft.update({
    data: { status: 'submitted' },
    where: { id },
  });

// @traces 206-FR-005
describe('the document routes', () => {
  it('answer with Cache-Control: no-store', () => {
    expect(
      Reflect.getMetadata(INTERCEPTORS_METADATA, ListingDocumentsController),
    ).toContain(NoStore);
  });
});

describe('the upload address', () => {
  // @traces 206-FR-003
  it('is signed for the draft for 15 minutes under an incoming legal_document key', async () => {
    const draft = await newDraft();
    const before = Date.now();

    const address = await documents.uploadAddress(
      draft.id,
      'rar_authorisation',
      draft.token,
      { contentType: 'application/pdf', size: 3 * MB },
    );

    expect(address.key).toMatch(
      new RegExp(`^incoming/legal_document/${draft.id}/[0-9a-f-]{36}$`),
    );
    expect(address.url).toContain(store.env().STORAGE_ENDPOINT);
    const minutes = (Date.parse(address.expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThanOrEqual(15.1);
  });

  // @traces 206-FR-005
  it('answers a wrong, foreign or missing token as the draft routes answer a wrong one', async () => {
    const draft = await newDraft();
    const other = await newDraft();
    const unknown = await refusalOf(drafts.current('not-a-key'));

    for (const token of ['not-a-key', other.token, undefined]) {
      const refused = await refusalOf(
        documents.uploadAddress(draft.id, 'onrc_certificate', token, {
          contentType: 'application/pdf',
          size: 100,
        }),
      );
      expect(refused).toEqual(unknown);
    }
    expect(unknown.status).toBe(404);
  });

  // @traces 206-FR-005
  it('is refused for a sent draft', async () => {
    const draft = await newDraft();
    await submit(draft.id);

    const refused = await refusalOf(
      documents.uploadAddress(draft.id, 'onrc_certificate', draft.token, {
        contentType: 'application/pdf',
        size: 100,
      }),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
  });

  // @traces 206-FR-003
  it.each(['identity_card', '__proto__', 'constructor'])(
    'refuses the unknown kind %s with document_kind_unknown',
    async (kind) => {
      const draft = await newDraft();

      const refused = await refusalOf(
        documents.uploadAddress(draft.id, kind, draft.token, {
          contentType: 'application/pdf',
          size: 100,
        }),
      );

      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: 'document_kind_unknown' });
    },
  );

  // @traces 206-FR-002
  it.each([
    [
      'a .docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      100,
      'file_type_not_allowed',
    ],
    ['a HEIC photo', 'image/heic', 100, 'file_type_not_allowed'],
    ['a 14 MB PDF', 'application/pdf', 14 * MB, 'file_too_large'],
  ])('refuses %s with a stable code', async (_, contentType, size, code) => {
    const draft = await newDraft();

    const refused = await refusalOf(
      documents.uploadAddress(draft.id, 'onrc_certificate', draft.token, {
        contentType,
        size,
      }),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code });
  });

  // @traces 206-FR-002
  it('is refused with document_full once the kind holds 10 pages, and not for the other kind', async () => {
    const draft = await newDraft();
    await holding(draft.id, 'onrc_certificate', 10);

    const refused = await refusalOf(
      documents.uploadAddress(draft.id, 'onrc_certificate', draft.token, {
        contentType: 'application/pdf',
        size: 100,
      }),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'document_full' });
    await expect(
      documents.uploadAddress(draft.id, 'rar_authorisation', draft.token, {
        contentType: 'image/jpeg',
        size: 100,
      }),
    ).resolves.toBeDefined();
  });
});

describe('confirming a page', () => {
  // @traces 206-FR-003
  it('creates the document on its first page and appends the next, answering the document', async () => {
    const draft = await newDraft();
    const before = await uploaded('rar_authorisation');
    const first = await upload(draft.id, draft.token, 'rar_authorisation');
    const second = await upload(
      draft.id,
      draft.token,
      'rar_authorisation',
      JPEG,
      'image/jpeg',
    );

    const one = await documents.confirm(
      draft.id,
      'rar_authorisation',
      draft.token,
      first,
    );
    const two = await documents.confirm(
      draft.id,
      'rar_authorisation',
      draft.token,
      second,
    );

    const [a, b] = [first, second].map((key) =>
      key.replace(/^incoming\//, ''),
    ) as [string, string];
    expect(one).toEqual({ kind: 'rar_authorisation', pages: [a] });
    expect(two).toEqual({ kind: 'rar_authorisation', pages: [a, b] });
    expect(await documentsOf(draft.id)).toEqual({
      rar_authorisation: { pages: [a, b] },
    });
    expect(store.objects.has(a)).toBe(true);
    expect(store.objects.has(first)).toBe(false);
    expect(await uploaded('rar_authorisation')).toBe(before + 2);
  });

  // @traces 206-FR-003
  it('keeps the issue date and the other kind when a page is added', async () => {
    const draft = await newDraft();
    const held = await holding(draft.id, 'onrc_certificate', 1, '2026-10-01');
    const other = await holding(draft.id, 'rar_authorisation', 1);
    const key = await upload(draft.id, draft.token);

    const answer = await documents.confirm(
      draft.id,
      'onrc_certificate',
      draft.token,
      key,
    );

    const page = key.replace(/^incoming\//, '');
    expect(answer).toEqual({
      issuedOn: '2026-10-01',
      kind: 'onrc_certificate',
      pages: [...held, page],
    });
    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: { issuedOn: '2026-10-01', pages: [...held, page] },
      rar_authorisation: { pages: other },
    });
  });

  // @traces 206-FR-002
  it('refuses the 11th page and deletes what was uploaded', async () => {
    const draft = await newDraft();
    const key = await upload(draft.id, draft.token);
    const held = await holding(draft.id, 'onrc_certificate', 10);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, key),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'document_full' });
    expect((await documentsOf(draft.id))?.['onrc_certificate']?.pages).toEqual(
      held,
    );
    expect([...store.objects.keys()].sort()).toEqual([...held].sort());
  });

  // @traces 206-FR-002
  it('refuses bytes that are not a PDF under a PDF type and deletes them', async () => {
    const draft = await newDraft();
    const key = await upload(
      draft.id,
      draft.token,
      'onrc_certificate',
      Buffer.from('PK\u0003\u0004 word document'),
    );

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, key),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'file_type_mismatch' });
    expect(await documentsOf(draft.id)).toBeUndefined();
    expect(store.objects.size).toBe(0);
  });

  // @traces 206-FR-003
  it('answers a replayed confirm with file_missing and holds the page once', async () => {
    const draft = await newDraft();
    const key = await upload(draft.id, draft.token);
    await documents.confirm(draft.id, 'onrc_certificate', draft.token, key);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, key),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(
      (await documentsOf(draft.id))?.['onrc_certificate']?.pages,
    ).toHaveLength(1);
  });

  // @traces 206-FR-003
  it('keeps a page once when a second confirm of it passed storage at the same time', async () => {
    const draft = await newDraft();
    const incoming = await upload(draft.id, draft.token);
    const confirmed = await documents.confirm(
      draft.id,
      'onrc_certificate',
      draft.token,
      incoming,
    );
    const page = confirmed.pages[0] as string;
    const racing = jest
      .spyOn(storage, 'confirmUpload')
      .mockResolvedValueOnce(page);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, incoming),
    );

    racing.mockRestore();
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect((await documentsOf(draft.id))?.['onrc_certificate']?.pages).toEqual([
      page,
    ]);
    expect(store.objects.has(page)).toBe(true);
  });

  // @traces 206-FR-003
  it('refuses a page held by the other kind of the same draft', async () => {
    const draft = await newDraft();
    const incoming = await upload(draft.id, draft.token, 'rar_authorisation');
    const confirmed = await documents.confirm(
      draft.id,
      'rar_authorisation',
      draft.token,
      incoming,
    );
    const page = confirmed.pages[0] as string;
    const racing = jest
      .spyOn(storage, 'confirmUpload')
      .mockResolvedValueOnce(page);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, incoming),
    );

    racing.mockRestore();
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await documentsOf(draft.id)).toEqual({
      rar_authorisation: { pages: [page] },
    });
    expect(store.objects.has(page)).toBe(true);
  });

  // @traces 206-FR-003
  it.each([
    ['uploaded for another draft', 'other'],
    ['never uploaded', 'unknown'],
  ])('refuses a key %s with file_missing', async (_, which) => {
    const draft = await newDraft();
    const other = await newDraft();
    const key =
      which === 'other'
        ? await upload(other.id, other.token)
        : `incoming/legal_document/${draft.id}/${randomUUID()}`;

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, key),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'file_missing' });
    expect(await documentsOf(draft.id)).toBeUndefined();
  });

  // @traces 206-FR-005
  it('refuses a page for a draft sent meanwhile and deletes the upload', async () => {
    const draft = await newDraft();
    const key = await upload(draft.id, draft.token);
    await submit(draft.id);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', draft.token, key),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
    expect(store.objects.size).toBe(0);
  });

  // @traces 206-FR-005
  it('touches nothing for a wrong token', async () => {
    const draft = await newDraft();
    const key = await upload(draft.id, draft.token);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'onrc_certificate', 'wrong', key),
    );

    expect(refused.status).toBe(404);
    expect(store.objects.has(key)).toBe(true);
    expect(await documentsOf(draft.id)).toBeUndefined();
  });

  // @traces 206-FR-003
  it('refuses an unknown kind, keeps the draft and deletes the upload', async () => {
    const draft = await newDraft();
    const key = await upload(draft.id, draft.token);

    const refused = await refusalOf(
      documents.confirm(draft.id, 'identity_card', draft.token, key),
    );

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'document_kind_unknown' });
    expect(store.objects.has(key)).toBe(false);
    expect(await documentsOf(draft.id)).toBeUndefined();
  });
});

describe('removing a page', () => {
  // @traces 206-FR-011
  it('takes the key out of the document and deletes the object', async () => {
    const draft = await newDraft();
    const [a, b, c] = (await holding(draft.id, 'rar_authorisation', 3)) as [
      string,
      string,
      string,
    ];

    await documents.remove(draft.id, 'rar_authorisation', draft.token, b);

    expect(await documentsOf(draft.id)).toEqual({
      rar_authorisation: { pages: [a, c] },
    });
    expect(store.objects.has(b)).toBe(false);
    expect(store.objects.has(a)).toBe(true);
  });

  // @traces 206-FR-011
  it('removes the document and its issue date with its last page, keeping the other kind', async () => {
    const draft = await newDraft();
    const [page] = await holding(draft.id, 'onrc_certificate', 1, '2026-10-01');
    const other = await holding(draft.id, 'rar_authorisation', 1);

    await documents.remove(
      draft.id,
      'onrc_certificate',
      draft.token,
      page as string,
    );

    expect(await documentsOf(draft.id)).toEqual({
      rar_authorisation: { pages: other },
    });
  });

  // @traces 206-FR-005
  it('answers 404 for a key the document does not hold and changes nothing', async () => {
    const draft = await newDraft();
    const mine = await holding(draft.id, 'onrc_certificate', 1);
    const theirs = await holding(draft.id, 'rar_authorisation', 1);

    for (const key of [theirs[0] as string, 'legal_document/x/y']) {
      const refused = await refusalOf(
        documents.remove(draft.id, 'onrc_certificate', draft.token, key),
      );
      expect(refused.status).toBe(404);
      expect(refused.body).toMatchObject({ code: 'not_found' });
    }
    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: { pages: mine },
      rar_authorisation: { pages: theirs },
    });
    expect(store.objects.has(theirs[0] as string)).toBe(true);
  });

  // @traces 206-FR-016
  it('still removes the key when storage fails, and logs the draft and key without the e-mail or the token', async () => {
    const draft = await newDraft();
    const [first, second] = (await holding(
      draft.id,
      'onrc_certificate',
      2,
    )) as [string, string];
    store.beforeDelete = () => {
      throw new Error('storage down');
    };
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await documents.remove(draft.id, 'onrc_certificate', draft.token, first);

    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: { pages: [second] },
    });
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain(
      `document page of draft ${draft.id} left in storage: ${first}`,
    );
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain(draft.token);
    logged.mockRestore();
  });

  // @traces 206-FR-005
  it('is refused for a wrong token, an unknown kind and a sent draft', async () => {
    const draft = await newDraft();
    const [page] = (await holding(draft.id, 'onrc_certificate', 1)) as [string];

    expect(
      (
        await refusalOf(
          documents.remove(draft.id, 'onrc_certificate', 'wrong', page),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await refusalOf(
          documents.remove(draft.id, 'identity_card', draft.token, page),
        )
      ).body,
    ).toMatchObject({ code: 'document_kind_unknown' });
    await submit(draft.id);
    const refused = await refusalOf(
      documents.remove(draft.id, 'onrc_certificate', draft.token, page),
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
    expect(store.objects.has(page)).toBe(true);
  });
});
