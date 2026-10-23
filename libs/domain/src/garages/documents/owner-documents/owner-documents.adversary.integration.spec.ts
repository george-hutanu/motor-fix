import {
  checksumOf,
  MB,
  ownerDocumentsApi,
  PDF,
} from './owner-documents.testing';
import { addDays, localDay } from '../../../bucharest';

const { http, page, prisma, store, submit, uploadUrl, world } =
  ownerDocumentsApi(14);

const today = () => localDay(new Date());
type World = Awaited<ReturnType<typeof world>>;

const inReview = (fileId: string) =>
  prisma.legalDocument.findMany({
    orderBy: { kind: 'asc' },
    where: { status: 'in_review', verificationFileId: fileId },
  });

const certificate = (pages: string[], issuedOn = addDays(today(), -1)) => ({
  issuedOn,
  kind: 'onrc_certificate',
  pages,
});
const authorisation = (pages: string[]) => ({
  issuedOn: '2025-02-10',
  kind: 'rar_authorisation',
  pages,
});

async function pair(w: World) {
  return [
    certificate([await page(w.dinamo.id, w.owner)]),
    authorisation([await page(w.dinamo.id, w.owner)]),
  ];
}

const unique = (n: number) =>
  Buffer.concat([PDF, Buffer.from(`page ${n} ${'x'.repeat(n)}`)]);

// @traces 068-FR-006
describe('asking for an upload address with hostile input', () => {
  const ok = {
    checksum: checksumOf(PDF),
    contentType: 'application/pdf',
    size: PDF.length,
  };

  it.each([
    ['text/html', { ...ok, contentType: 'text/html' }],
    ['image/gif', { ...ok, contentType: 'image/gif' }],
    ['application/zip', { ...ok, contentType: 'application/zip' }],
    [
      'an upper-case type',
      { ...ok, contentType: 'APPLICATION/PDF; charset=x' },
    ],
  ])('refuses the content type %s and signs nothing', async (_, body) => {
    const w = await world();

    const answer = await uploadUrl(w.dinamo.id, w.owner, body);

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
    expect(answer.body.url).toBeUndefined();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['a fraction', 1.5],
    ['text', '12'],
    ['null', null],
    ['over 10 MB', 10 * MB + 1],
  ])('refuses a size of %s', async (_, size) => {
    const w = await world();

    const answer = await uploadUrl(w.dinamo.id, w.owner, { ...ok, size });

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
    expect(answer.body.url).toBeUndefined();
  });

  it('signs an address for exactly 10 MB', async () => {
    const w = await world();

    const answer = await uploadUrl(w.dinamo.id, w.owner, {
      ...ok,
      size: 10 * MB,
    });

    expect(answer.status).toBe(201);
  });

  it.each([
    ['empty', ''],
    ['not base64', '!!!'],
    ['a number', 5],
  ])('refuses a checksum that is %s', async (_, checksum) => {
    const w = await world();

    const answer = await uploadUrl(w.dinamo.id, w.owner, { ...ok, checksum });

    expect(answer.status).toBe(400);
  });

  it('refuses a field it does not know', async () => {
    const w = await world();

    const answer = await uploadUrl(w.dinamo.id, w.owner, {
      ...ok,
      purpose: 'avatar',
    });

    expect(answer.status).toBe(400);
  });

  it('still signs an address while only one kind waits for review', async () => {
    const w = await world();
    await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['legal_document/x/1'],
        status: 'in_review',
        verificationFileId: w.file.id,
      },
    });

    const answer = await uploadUrl(w.dinamo.id, w.owner, ok);

    expect(answer.status).toBe(201);
  });

  it('keeps a key under the asking garage', async () => {
    const w = await world();

    const answer = await uploadUrl(w.dinamo.id, w.owner, ok);

    expect(answer.body.key).toContain(`legal_document/${w.dinamo.id}/`);
    expect(answer.body.key).not.toContain(w.nord.id);
  });

  it('answers 404 for a malformed garage id and a path-like one', async () => {
    const w = await world();

    for (const id of ['x', '..%2F..', '%00']) {
      expect((await uploadUrl(id, w.owner)).status).toBe(404);
    }
  });
});

// @traces 068-FR-007
describe('sending the yearly documents with hostile bodies', () => {
  it.each([
    ['no documents', { documents: [] }],
    ['no body fields', {}],
    [
      'an entry with no kind',
      { documents: [{ issuedOn: '2026-10-01', pages: ['k'] }] },
    ],
    ['an unknown top-level field', { documents: [], extra: 1 }],
  ])('refuses %s and stores nothing', async (_, body) => {
    const w = await world();

    const answer = await submit(w.dinamo.id, w.owner, body);

    expect(answer.status).toBe(400);
    expect(await inReview(w.file.id)).toEqual([]);
  });

  it('refuses eleven pages for one document and stores nothing', async () => {
    const w = await world();
    const pages = [];
    for (let n = 0; n < 11; n += 1) {
      pages.push(await page(w.dinamo.id, w.owner, unique(n)));
    }
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [certificate(pages), rar],
    });

    expect(answer.status).toBe(400);
    expect(await inReview(w.file.id)).toEqual([]);
    expect(store.objects.has(pages[0] ?? '')).toBe(true);
  });

  it('stores ten pages in the order sent', async () => {
    const w = await world();
    const sent = [];
    for (let n = 0; n < 10; n += 1) {
      sent.push(await page(w.dinamo.id, w.owner, unique(n + 1)));
    }
    const reversed = [...sent].reverse();
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [certificate(reversed), rar],
    });

    expect(answer.status).toBe(201);
    const [onrc] = await inReview(w.file.id);
    expect(onrc?.pages).toHaveLength(10);
    const stored = (onrc?.pages ?? []).map(
      (key) => store.objects.get(key)?.body.length,
    );
    expect(stored).toEqual(
      Array.from({ length: 10 }, (_, i) => unique(10 - i).length),
    );
  });

  it.each([
    ['an empty key', ''],
    ['a key with a parent path', 'incoming/legal_document/../../x'],
    ['an absolute path', '/etc/passwd'],
    ['a key of another purpose', 'incoming/avatar/abc'],
  ])('answers a client error for %s and stores nothing', async (_, key) => {
    const w = await world();
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [certificate([key]), rar],
    });

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
    expect(await inReview(w.file.id)).toEqual([]);
  });

  it.each(['2026-02-30', '2026-13-01', '10-10-2026', '', null])(
    'refuses the issue date %j with a client error and stores nothing',
    async (issuedOn) => {
      const w = await world();
      const [, rar] = await pair(w);
      const cert = certificate([await page(w.dinamo.id, w.owner)]);

      const answer = await submit(w.dinamo.id, w.owner, {
        documents: [{ ...cert, issuedOn }, rar],
      });

      expect(answer.status).toBe(400);
      expect(await inReview(w.file.id)).toEqual([]);
    },
  );

  it('takes a certificate issued today', async () => {
    const w = await world();
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);
    const cert = certificate([await page(w.dinamo.id, w.owner)], today());

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [cert, rar],
    });

    expect(answer.status).toBe(201);
  });

  it('keeps the uploaded pages for a retry after certificate_too_old, and the retry stores them', async () => {
    const w = await world();
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);
    const key = await page(w.dinamo.id, w.owner);

    const refused = await submit(w.dinamo.id, w.owner, {
      documents: [certificate([key], addDays(today(), -31)), rar],
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'certificate_too_old' });
    expect(store.objects.has(key)).toBe(true);
    expect(store.objects.has(rar.pages[0] ?? '')).toBe(true);

    const retry = await submit(w.dinamo.id, w.owner, {
      documents: [certificate([key], addDays(today(), -30)), rar],
    });
    expect(retry.status).toBe(201);
    expect(await inReview(w.file.id)).toHaveLength(2);
  });

  it('keeps the pages for a retry after both_documents_required', async () => {
    const w = await world();
    const key = await page(w.dinamo.id, w.owner);

    const refused = await submit(w.dinamo.id, w.owner, {
      documents: [certificate([key])],
    });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'both_documents_required' });
    expect(store.objects.has(key)).toBe(true);
  });

  it('refuses a PNG declared as a JPEG with file_type_mismatch', async () => {
    const w = await world();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    const key = await page(w.dinamo.id, w.owner, png, 'image/jpeg');
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [certificate([key]), rar],
    });

    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: 'file_type_mismatch' });
    expect(await inReview(w.file.id)).toEqual([]);
  });

  it('refuses text bytes declared as a PDF with file_type_mismatch', async () => {
    const w = await world();
    const key = await page(
      w.dinamo.id,
      w.owner,
      Buffer.from('hello, not a pdf'),
    );
    const rar = authorisation([await page(w.dinamo.id, w.owner)]);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [certificate([key]), rar],
    });

    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: 'file_type_mismatch' });
  });
});

// @traces 068-FR-007
describe('an entry that is a list', () => {
  it('is refused with a client error and stores nothing', async () => {
    const w = await world();

    const answer = await submit(w.dinamo.id, w.owner, { documents: [[]] });

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
    expect(await inReview(w.file.id)).toEqual([]);
  });
});

// @traces 068-FR-007
describe('the one-kind exceptions', () => {
  it('takes the refused kind alone when the other was accepted since the reset', async () => {
    const w = await world();
    await prisma.verificationFile.update({
      data: {},
      where: { id: w.file.id },
    });
    const garage = await prisma.documentCycle.findUniqueOrThrow({
      where: { garageId: w.dinamo.id },
    });
    await prisma.legalDocument.updateMany({
      data: {
        decidedAt: new Date(garage.resetAt.getTime() + 3600_000),
        decidedBy: w.accounts.ana,
      },
      where: { kind: 'onrc_certificate', verificationFileId: w.file.id },
    });
    await prisma.legalDocument.create({
      data: {
        decidedAt: new Date(),
        decidedBy: w.accounts.ana,
        kind: 'rar_authorisation',
        pages: ['legal_document/x/r'],
        refusalNote: 'Ilizibil',
        refusalReason: 'documents',
        status: 'refused',
        verificationFileId: w.file.id,
      },
    });
    const key = await page(w.dinamo.id, w.owner);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [authorisation([key])],
    });

    expect(answer.status).toBe(201);
    expect(await inReview(w.file.id)).toHaveLength(1);
  });

  it('answers document_in_review to a kind sent alone while it is in review', async () => {
    const w = await world();
    await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['legal_document/x/1'],
        status: 'in_review',
        verificationFileId: w.file.id,
      },
    });
    const key = await page(w.dinamo.id, w.owner);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [authorisation([key])],
    });

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'document_in_review' });
    expect(await inReview(w.file.id)).toHaveLength(1);
  });

  it('refuses to send the same kind alone twice', async () => {
    const w = await world();
    await prisma.legalDocument.create({
      data: {
        kind: 'onrc_certificate',
        pages: ['legal_document/x/c'],
        status: 'in_review',
        verificationFileId: w.file.id,
      },
    });
    const first = await page(w.dinamo.id, w.owner);
    const second = await page(w.dinamo.id, w.owner);

    const one = await submit(w.dinamo.id, w.owner, {
      documents: [authorisation([first])],
    });
    const two = await submit(w.dinamo.id, w.owner, {
      documents: [authorisation([second])],
    });

    expect([one.status, two.status]).toEqual([201, 409]);
    expect(await inReview(w.file.id)).toHaveLength(2);
  });
});

// @traces 068-FR-007
describe('sending twice and from the wrong place', () => {
  it('stores one pair when the same body is sent three times at once', async () => {
    const w = await world();
    const body = { documents: await pair(w) };

    const answers = await Promise.all([
      submit(w.dinamo.id, w.owner, body),
      submit(w.dinamo.id, w.owner, body),
      submit(w.dinamo.id, w.owner, body),
    ]);

    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect(
      answers.filter((a) => a.status !== 201).every((a) => a.status < 500),
    ).toBe(true);
    expect(await inReview(w.file.id)).toHaveLength(2);
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: 'document.uploaded',
          subjectId: { in: (await inReview(w.file.id)).map((d) => d.id) },
        },
      }),
    ).toBe(2);
  });

  it('stores one pair when two different bodies are sent at once', async () => {
    const w = await world();
    const a = { documents: await pair(w) };
    const b = { documents: await pair(w) };

    const answers = await Promise.all([
      submit(w.dinamo.id, w.owner, a),
      submit(w.dinamo.id, w.owner, b),
    ]);

    expect(answers.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await inReview(w.file.id)).toHaveLength(2);
  });

  it('refuses another garage pages and leaves the other garage nothing', async () => {
    const w = await world();
    const mine = await pair(w);
    await prisma.verificationFile.create({
      data: { garageId: w.nord.id, status: 'approved' },
    });
    await prisma.documentCycle.create({
      data: { dueOn: new Date('2026-11-01'), garageId: w.nord.id },
    });
    const theirs = authorisation([await page(w.nord.id, w.other)]);

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: [mine[0], theirs],
    });

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'file_missing' });
    expect(await inReview(w.file.id)).toEqual([]);
  });

  it('answers 401 without a session on both routes', async () => {
    const w = await world();

    const a = await http()
      .post(`/garages/${w.dinamo.id}/legal-documents`)
      .send({ documents: [] });
    const b = await http()
      .post(`/garages/${w.dinamo.id}/legal-documents/upload-url`)
      .send({});

    expect([a.status, b.status]).toEqual([401, 401]);
  });

  it('answers a suspended garage owner like any owner', async () => {
    const w = await world({ status: 'suspended' });

    const answer = await submit(w.dinamo.id, w.owner, {
      documents: await pair(w),
    });

    expect(answer.status).toBe(201);
  });
});
