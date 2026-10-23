import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import { MB, ownerDocumentsApi, PDF } from './owner-documents.testing';
import { addDays, localDay } from '../../../bucharest';
import { bellText } from '../../../notifications/templates';

const { page, prisma, store, submit, world } = ownerDocumentsApi(8);

const reader = countedMetrics();
const uploaded = () =>
  counterTotal(reader, 'motorfix_document_cycle_total', { step: 'uploaded' });

const today = () => localDay(new Date());

type World = Awaited<ReturnType<typeof world>>;

async function both(people: World, issuedOn = addDays(today(), -3)) {
  const certificate = [
    await page(people.dinamo.id, people.owner),
    await page(people.dinamo.id, people.owner),
  ];
  const authorisation = [await page(people.dinamo.id, people.owner)];
  return {
    documents: [
      { issuedOn, kind: 'onrc_certificate', pages: certificate },
      {
        issuedOn: '2025-02-10',
        kind: 'rar_authorisation',
        pages: authorisation,
      },
    ],
  };
}

const rowsOf = (fileId: string) =>
  prisma.legalDocument.findMany({
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    where: { verificationFileId: fileId },
  });

const inReview = (fileId: string) =>
  prisma.legalDocument.findMany({
    orderBy: { kind: 'asc' },
    where: { status: 'in_review', verificationFileId: fileId },
  });

// A yearly document an admin accepted at `decidedAt`.
const accepted = (
  people: World,
  kind: 'onrc_certificate' | 'rar_authorisation',
  decidedAt: Date,
) =>
  prisma.legalDocument.updateMany({
    data: { decidedAt, decidedBy: people.accounts.ana },
    where: { kind, verificationFileId: people.file.id },
  });

// @traces 068-FR-007
// @traces 068-FR-008
describe('sending the yearly documents', () => {
  it('stores one in_review document per kind beside the valid ones and answers the cycle', async () => {
    const people = await world();
    const body = await both(people);

    const answer = await submit(people.dinamo.id, people.owner, body);

    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      dueOn: '2026-11-01',
      graceUntil: null,
      inReview: true,
      state: 'due',
    });
    const rows = await rowsOf(people.file.id);
    expect(rows.map((r) => [r.kind, r.status, r.replacedAt])).toEqual([
      ['onrc_certificate', 'valid', null],
      ['onrc_certificate', 'in_review', null],
      ['rar_authorisation', 'valid', null],
      ['rar_authorisation', 'in_review', null],
    ]);
    const [certificate, authorisation] = await inReview(people.file.id);
    const final = (key: string) => key.replace(/^incoming\//, '');
    expect(certificate?.pages).toEqual(body.documents[0]?.pages.map(final));
    expect(authorisation?.pages).toEqual(body.documents[1]?.pages.map(final));
    expect(certificate?.issuedOn?.toISOString().slice(0, 10)).toBe(
      body.documents[0]?.issuedOn,
    );
    expect(authorisation?.decidedAt).toBeNull();
    for (const key of [...(certificate?.pages ?? [])]) {
      expect(store.objects.has(key)).toBe(true);
      expect(store.objects.has(`incoming/${key}`)).toBe(false);
    }
  });

  it('takes one kind alone when the other was accepted since the cycle was reset', async () => {
    const people = await world();
    await accepted(
      people,
      'onrc_certificate',
      new Date('2026-01-10T10:00:00Z'),
    );
    const key = await page(people.dinamo.id, people.owner);

    const answer = await submit(people.dinamo.id, people.owner, {
      documents: [
        { issuedOn: '2025-02-10', kind: 'rar_authorisation', pages: [key] },
      ],
    });

    expect(answer.status).toBe(201);
    expect((await inReview(people.file.id)).map((d) => d.kind)).toEqual([
      'rar_authorisation',
    ]);
  });

  it('takes one kind alone when the other is in review', async () => {
    const people = await world();
    await prisma.legalDocument.create({
      data: {
        kind: 'onrc_certificate',
        pages: ['legal_document/x/1'],
        status: 'in_review',
        verificationFileId: people.file.id,
      },
    });
    const key = await page(people.dinamo.id, people.owner);

    const answer = await submit(people.dinamo.id, people.owner, {
      documents: [
        { issuedOn: '2025-02-10', kind: 'rar_authorisation', pages: [key] },
      ],
    });

    expect(answer.status).toBe(201);
    expect(await inReview(people.file.id)).toHaveLength(2);
  });

  it.each([
    ['only the listing document', undefined],
    ['one accepted before the reset', new Date('2025-10-30T10:00:00Z')],
  ])(
    'refuses one kind alone when the other has %s, storing nothing',
    async (_, decidedAt) => {
      const people = await world();
      if (decidedAt) await accepted(people, 'onrc_certificate', decidedAt);
      const key = await page(people.dinamo.id, people.owner);

      const answer = await submit(people.dinamo.id, people.owner, {
        documents: [
          { issuedOn: '2025-02-10', kind: 'rar_authorisation', pages: [key] },
        ],
      });

      expect(answer.status).toBe(422);
      expect(answer.body).toMatchObject({ code: 'both_documents_required' });
      expect(await inReview(people.file.id)).toEqual([]);
      expect(store.objects.has(key)).toBe(true);
    },
  );

  it('refuses a kind already in review with document_in_review and stores nothing', async () => {
    const people = await world();
    await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['legal_document/x/1'],
        status: 'in_review',
        verificationFileId: people.file.id,
      },
    });
    const body = await both(people);

    const answer = await submit(people.dinamo.id, people.owner, body);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'document_in_review' });
    expect(await inReview(people.file.id)).toHaveLength(1);
  });

  it('takes a certificate issued 30 days ago and refuses one of 31 days', async () => {
    const people = await world();
    const old = await submit(
      people.dinamo.id,
      people.owner,
      await both(people, addDays(today(), -31)),
    );
    expect(old.status).toBe(422);
    expect(old.body).toMatchObject({ code: 'certificate_too_old' });
    expect(await inReview(people.file.id)).toEqual([]);

    const edge = await submit(
      people.dinamo.id,
      people.owner,
      await both(people, addDays(today(), -30)),
    );
    expect(edge.status).toBe(201);
  });

  it('refuses a certificate dated after today', async () => {
    const people = await world();
    const answer = await submit(
      people.dinamo.id,
      people.owner,
      await both(people, addDays(today(), 1)),
    );
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: 'certificate_too_old' });
  });

  it.each([
    [
      'never uploaded',
      (id: string) => `incoming/legal_document/${id}/${randomUUID()}`,
    ],
    [
      'of another garage',
      (_: string, other: string) =>
        `incoming/legal_document/${other}/${randomUUID()}`,
    ],
  ])(
    'refuses a page %s with file_missing and keeps none of the pages it moved',
    async (_, keyOf) => {
      const people = await world();
      const body = await both(people);
      const bad = keyOf(people.dinamo.id, people.nord.id);
      body.documents[1]?.pages.push(bad);

      const answer = await submit(people.dinamo.id, people.owner, body);

      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ code: 'file_missing' });
      expect(await inReview(people.file.id)).toEqual([]);
      const kept = [...store.objects.keys()].filter((k) =>
        k.startsWith(`legal_document/${people.dinamo.id}/`),
      );
      expect(kept).toEqual([]);
    },
  );

  it('refuses a page sent twice with file_missing', async () => {
    const people = await world();
    const key = await page(people.dinamo.id, people.owner);
    const answer = await submit(people.dinamo.id, people.owner, {
      documents: [
        { issuedOn: today(), kind: 'onrc_certificate', pages: [key] },
        { issuedOn: '2025-02-10', kind: 'rar_authorisation', pages: [key] },
      ],
    });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'file_missing' });
  });

  it('refuses bytes that are not the PDF they were declared as', async () => {
    const people = await world();
    const body = await both(people);
    const word = await page(
      people.dinamo.id,
      people.owner,
      Buffer.from('PK\u0003\u0004 word document'),
    );
    body.documents[0]?.pages.push(word);

    const answer = await submit(people.dinamo.id, people.owner, body);

    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: 'file_type_mismatch' });
    expect(await inReview(people.file.id)).toEqual([]);
  });

  it('refuses a stored page over 10 MB with file_too_large', async () => {
    const people = await world();
    const body = await both(people);
    const big = `incoming/legal_document/${people.dinamo.id}/${randomUUID()}`;
    store.objects.set(big, {
      body: Buffer.concat([PDF, Buffer.alloc(10 * MB)]),
      contentType: 'application/pdf',
      etag: '"big"',
      metadata: {},
    });
    body.documents[0]?.pages.push(big);

    const answer = await submit(people.dinamo.id, people.owner, body);

    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: 'file_too_large' });
  });

  it('refuses a malformed body with validation_failed', async () => {
    const people = await world();
    const answer = await submit(people.dinamo.id, people.owner, {
      documents: [{ kind: 'identity_card', pages: [] }],
    });
    expect(answer.status).toBe(400);
  });

  it.each(['receptionist', 'mechanic'] as const)(
    "refuses the garage's %s with not_owner",
    async (who) => {
      const people = await world();
      const body = await both(people);

      const answer = await submit(people.dinamo.id, people[who], body);

      expect(answer.status).toBe(403);
      expect(answer.body).toMatchObject({ code: 'not_owner' });
      expect(await inReview(people.file.id)).toEqual([]);
    },
  );

  it.each(['other', 'driver', 'admin'] as const)(
    'answers 404 to %s',
    async (who) => {
      const people = await world();
      const body = await both(people);
      expect((await submit(people.dinamo.id, people[who], body)).status).toBe(
        404,
      );
    },
  );

  it('answers 404 for a draft garage', async () => {
    const people = await world({ status: 'draft' });
    const answer = await submit(people.dinamo.id, people.owner, {
      documents: [
        {
          issuedOn: today(),
          kind: 'onrc_certificate',
          pages: [
            `incoming/legal_document/${people.dinamo.id}/${randomUUID()}`,
          ],
        },
      ],
    });
    expect(answer.status).toBe(404);
  });
});

// @traces 068-FR-013
// @traces 068-FR-014
// @traces 068-FR-016
describe('what an upload records', () => {
  it('writes one audit entry by the owner and one event to the admins and the garage per document, and counts the upload once', async () => {
    const people = await world();
    const before = await uploaded();

    await submit(people.dinamo.id, people.owner, await both(people));

    const documents = await inReview(people.file.id);
    const audit = await prisma.activityLog.findMany({
      where: {
        subjectId: { in: documents.map((d) => d.id) },
        subjectType: 'legal_document',
      },
    });
    expect(
      audit.map((a) => [a.action, a.actorId, a.actorRole, a.garageId]).sort(),
    ).toEqual([
      ['create', people.accounts.radu, 'owner', people.dinamo.id],
      ['create', people.accounts.radu, 'owner', people.dinamo.id],
    ]);
    const events = await prisma.outboxEvent.findMany({
      where: {
        kind: 'document.uploaded',
        subjectId: { in: documents.map((d) => d.id) },
      },
    });
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect([...event.audience].sort()).toEqual(
        ['admin', `garage:${people.dinamo.id}`].sort(),
      );
      expect(event.payload).toMatchObject({ garageId: people.dinamo.id });
    }
    expect(await uploaded()).toBe(before + 1);
  });
});

// @traces 068-FR-011
// @traces 068-FR-017
describe('telling the admins', () => {
  const told = (accountId: string) =>
    prisma.notification.findMany({
      where: { accountId, fallbackOf: null, kind: 'ADMIN_VERIFICATION_QUEUED' },
    });

  it('tells every active admin once per upload, naming the garage and the yearly documents', async () => {
    const people = await world();

    await submit(people.dinamo.id, people.owner, await both(people));

    const ana = await told(people.accounts.ana);
    const dan = await told(people.accounts.dan);
    expect(ana.length).toBeGreaterThan(0);
    expect(new Set([...ana, ...dan].map((n) => n.eventId)).size).toBe(1);
    expect(await told(people.accounts.gone)).toEqual([]);
    const params = ana[0]?.params as Record<string, unknown>;
    expect(bellText('ADMIN_VERIFICATION_QUEUED', 'ro', params)).toBe(
      'Documente anuale de verificat: ATELIER DINAMO SRL',
    );
    expect(bellText('ADMIN_VERIFICATION_QUEUED', 'en', params)).toBe(
      'Yearly documents to check: ATELIER DINAMO SRL',
    );
  });

  it('tells them again for the next upload', async () => {
    const people = await world();
    await accepted(
      people,
      'onrc_certificate',
      new Date('2026-01-10T10:00:00Z'),
    );
    await accepted(
      people,
      'rar_authorisation',
      new Date('2026-01-10T10:00:00Z'),
    );
    const first = await page(people.dinamo.id, people.owner);
    await submit(people.dinamo.id, people.owner, {
      documents: [
        { issuedOn: today(), kind: 'onrc_certificate', pages: [first] },
      ],
    });
    const second = await page(people.dinamo.id, people.owner);
    await submit(people.dinamo.id, people.owner, {
      documents: [
        { issuedOn: '2025-02-10', kind: 'rar_authorisation', pages: [second] },
      ],
    });

    const ana = await told(people.accounts.ana);
    expect(new Set(ana.map((n) => n.eventId)).size).toBe(2);
  });

  it('tells nobody when the upload is refused', async () => {
    const people = await world();
    await submit(
      people.dinamo.id,
      people.owner,
      await both(people, addDays(today(), -40)),
    );
    expect(await told(people.accounts.ana)).toEqual([]);
  });
});
