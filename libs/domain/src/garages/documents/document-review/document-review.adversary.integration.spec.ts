import { day, documentReviewApi } from './document-review.testing';
import { signAccessToken } from '../../../auth/access-token';
import { addMonths, localDay } from '../../../bucharest';
import { fixtures } from '../../../notifications/notifications.testing';

const { accept, http, prisma, refuse, world } = documentReviewApi();
const { account } = fixtures();

const NOTE = { note: 'Certificatul este ilizibil', reason: 'documents' };

const statusOf = async (id: string) =>
  (await prisma.legalDocument.findUniqueOrThrow({ where: { id } })).status;
const eventCount = (kind: string, ids?: string[]) =>
  prisma.outboxEvent.count({
    where: { kind, ...(ids && { subjectId: { in: ids } }) },
  });

// @traces 068-FR-010
describe('the refusal note as the route receives it', () => {
  it('stores a note of exactly 500 characters and refuses 501, changing nothing', async () => {
    const w = await world();

    const over = await refuse(w.fresh.onrc_certificate.id, w.admin, {
      note: 'a'.repeat(501),
      reason: 'other',
    });
    expect(over.status).toBe(400);
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('in_review');
    expect(
      await eventCount('document.refused', [w.fresh.onrc_certificate.id]),
    ).toBe(0);

    const exact = await refuse(w.fresh.onrc_certificate.id, w.admin, {
      note: 'a'.repeat(500),
      reason: 'other',
    });
    expect(exact.status).toBe(200);
    const stored = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(stored.refusalNote).toBe('a'.repeat(500));
  });

  it('stores the note trimmed, line breaks kept', async () => {
    const w = await world();

    await refuse(w.fresh.onrc_certificate.id, w.admin, {
      note: '  Pagina 1\nPagina 2 \t ',
      reason: 'other',
    });

    const stored = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(stored.refusalNote).toBe('Pagina 1\nPagina 2');
  });

  it.each([
    ['one space', ' '],
    ['a line break', '\n'],
    ['a null byte', 'Notă\u0000'],
    ['a delete character', 'Notă\u007f'],
    ['a next-line character', '\u0085Notă'],
    ['null', null],
    ['a number', 5],
    ['a list', ['Notă']],
    ['an object', { text: 'Notă' }],
  ])('refuses a note that is %s with 400', async (_, note) => {
    const w = await world();

    const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, {
      note,
      reason: 'other',
    });

    expect(answer.status).toBe(400);
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('in_review');
    expect(
      await eventCount('document.refused', [w.fresh.onrc_certificate.id]),
    ).toBe(0);
  });

  it.each([
    ['null', null],
    ['an upper-case reason', 'OTHER'],
    ['a list', ['other']],
    ['a prototype key', '__proto__'],
  ])('refuses %s as the reason with 400', async (_, reason) => {
    const w = await world();

    const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, {
      note: 'Notă',
      reason,
    });

    expect(answer.status).toBe(400);
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('in_review');
  });

  it('refuses a body with a field it does not know, and an empty body', async () => {
    const w = await world();

    for (const body of [{ ...NOTE, status: 'valid' }, {}]) {
      const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, body);
      expect(answer.status).toBe(400);
    }
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('in_review');
  });

  it('keeps the note as an admin wrote it, markup and unicode included', async () => {
    const w = await world();
    const note = '<b>Ștampilă</b> lipsă 🚗 & "citeț"';

    const answer = await refuse(w.fresh.rar_authorisation.id, w.admin, {
      note,
      reason: 'documents',
    });

    expect(answer.status).toBe(200);
    const stored = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.rar_authorisation.id },
    });
    expect(stored.refusalNote).toBe(note);
    expect(stored.refusalReason).toBe('documents');
  });
});

// @traces 068-FR-009
// @traces 068-FR-010
describe('deciding a document that was already decided', () => {
  it('answers 409 document_not_in_review to a second accept and moves nothing', async () => {
    const w = await world();
    await accept(w.fresh.onrc_certificate.id, w.admin);
    const id = w.fresh.onrc_certificate.id;
    const events = await eventCount('document.accepted', [id]);
    const history = await prisma.activityLog.count({
      where: { subjectId: id },
    });

    const again = await accept(w.fresh.onrc_certificate.id, w.admin);

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('document_not_in_review');
    expect(await eventCount('document.accepted', [id])).toBe(events);
    expect(await prisma.activityLog.count({ where: { subjectId: id } })).toBe(
      history,
    );
  });

  it('answers 409 to a refusal of an accepted document and keeps it valid', async () => {
    const w = await world();
    await accept(w.fresh.onrc_certificate.id, w.admin);

    const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, NOTE);

    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('document_not_in_review');
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('valid');
  });

  it('answers 409 to an accept of a refused document and keeps it refused with the earlier one valid', async () => {
    const w = await world();
    await refuse(w.fresh.onrc_certificate.id, w.admin, NOTE);

    const answer = await accept(w.fresh.onrc_certificate.id, w.admin);

    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('document_not_in_review');
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('refused');
    const earlier = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.old.onrc_certificate.id },
    });
    expect(earlier.replacedAt).toBeNull();
  });

  it('answers 409 to an accept of a document an acceptance replaced', async () => {
    const w = await world();
    await accept(w.fresh.onrc_certificate.id, w.admin);

    const answer = await accept(w.old.onrc_certificate.id, w.admin);

    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('document_not_in_review');
  });

  it('answers 409 to an accept of a listing document that was never in review', async () => {
    const w = await world();

    const answer = await accept(w.old.rar_authorisation.id, w.admin);

    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('document_not_in_review');
    expect(
      (
        await prisma.legalDocument.findUniqueOrThrow({
          where: { id: w.old.rar_authorisation.id },
        })
      ).decidedBy,
    ).toBeNull();
  });

  it('lets exactly one of two admins win an accept sent at once', async () => {
    const w = await world();

    const answers = await Promise.all([
      accept(w.fresh.onrc_certificate.id, w.admin),
      accept(w.fresh.onrc_certificate.id, w.admin),
      accept(w.fresh.onrc_certificate.id, w.admin),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409, 409]);
    expect(
      await eventCount('document.accepted', [w.fresh.onrc_certificate.id]),
    ).toBe(1);
  });

  it('lets exactly one of an accept and a refusal sent at once win', async () => {
    const w = await world();

    const answers = await Promise.all([
      accept(w.fresh.onrc_certificate.id, w.admin),
      refuse(w.fresh.onrc_certificate.id, w.admin, NOTE),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(
      (await eventCount('document.accepted', [w.fresh.onrc_certificate.id])) +
        (await eventCount('document.refused', [w.fresh.onrc_certificate.id])),
    ).toBe(1);
  });

  it('moves the due date once when the two kinds are accepted at once', async () => {
    const w = await world();

    const answers = await Promise.all([
      accept(w.fresh.onrc_certificate.id, w.admin),
      accept(w.fresh.rar_authorisation.id, w.admin),
    ]);

    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect(day(cycle.dueOn)).toBe(addMonths(localDay(new Date()), 12));
    expect(
      await prisma.activityLog.count({
        where: { field: 'documents_due_on', garageId: w.dinamo.id },
      }),
    ).toBe(1);
  });
});

// @traces 068-FR-009
describe('accepting under an overdue cycle and across garages', () => {
  it('clears the grace and returns to due once both kinds are accepted', async () => {
    const w = await world({
      dueOn: '2026-10-01',
      graceUntil: '2026-10-15',
      state: 'overdue',
    });

    await accept(w.fresh.onrc_certificate.id, w.admin);
    const mid = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect([mid.state, day(mid.graceUntil)]).toEqual(['overdue', '2026-10-15']);

    const last = await accept(w.fresh.rar_authorisation.id, w.admin);

    expect(last.status).toBe(200);
    expect(last.body.cycle).toMatchObject({
      dueOn: addMonths(localDay(new Date()), 12),
      graceUntil: null,
      state: 'due',
    });
    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect([cycle.state, cycle.graceUntil]).toEqual(['due', null]);
    expect([cycle.reminded30At, cycle.reminded7At, cycle.reminded0At]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('leaves another garage cycle and documents alone', async () => {
    const w = await world();
    const nord = await prisma.garage.create({
      data: { name: 'Nord', slug: `nord-${w.dinamo.id}`, status: 'approved' },
    });
    const nordFile = await prisma.verificationFile.create({
      data: { garageId: nord.id, status: 'approved' },
    });
    const waiting = await prisma.legalDocument.create({
      data: {
        kind: 'onrc_certificate',
        pages: ['p'],
        status: 'in_review',
        verificationFileId: nordFile.id,
      },
    });
    const nordCycle = await prisma.documentCycle.create({
      data: { dueOn: new Date('2026-11-01'), garageId: nord.id },
    });

    await accept(w.fresh.onrc_certificate.id, w.admin);
    await accept(w.fresh.rar_authorisation.id, w.admin);

    expect(await statusOf(waiting.id)).toBe('in_review');
    const untouched = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: nordCycle.id },
    });
    expect(day(untouched.dueOn)).toBe('2026-11-01');
  });

  it('refuses the decision of one kind while leaving the due date where it was', async () => {
    const w = await world({
      dueOn: '2026-10-01',
      graceUntil: '2026-10-15',
      state: 'overdue',
    });

    await refuse(w.fresh.onrc_certificate.id, w.admin, NOTE);
    await accept(w.fresh.rar_authorisation.id, w.admin);

    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect([day(cycle.dueOn), cycle.state, day(cycle.graceUntil)]).toEqual([
      '2026-10-01',
      'overdue',
      '2026-10-15',
    ]);
  });
});

// @traces 068-FR-009
// @traces 068-FR-010
describe('who may decide', () => {
  it('answers 401 without a session, for both routes, changing nothing', async () => {
    const w = await world();

    const a = await http()
      .post(`/admin/legal-documents/${w.fresh.onrc_certificate.id}/accept`)
      .send();
    const r = await http()
      .post(`/admin/legal-documents/${w.fresh.onrc_certificate.id}/refuse`)
      .send(NOTE);

    expect([a.status, r.status]).toEqual([401, 401]);
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('in_review');
  });

  it('answers 404 to a receptionist and a mechanic of the garage, for both routes', async () => {
    const w = await world();
    const ioana = await account('ioana', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: ioana, garageId: w.dinamo.id, role: 'receptionist' },
    });
    const staff = `Bearer ${signAccessToken({ accountId: ioana, role: 'receptionist' }, 'test-secret')}`;

    expect((await accept(w.fresh.onrc_certificate.id, staff)).status).toBe(404);
    expect(
      (await refuse(w.fresh.onrc_certificate.id, staff, NOTE)).status,
    ).toBe(404);
    expect(await statusOf(w.fresh.onrc_certificate.id)).toBe('in_review');
  });

  it.each([
    'not-a-uuid',
    '0',
    "1' OR '1'='1",
    '%00',
    '00000000-0000-0000-0000-000000000000',
  ])('answers 404 for the id %j on both routes', async (id) => {
    const w = await world();

    expect((await accept(encodeURIComponent(id), w.admin)).status).toBe(404);
    expect((await refuse(encodeURIComponent(id), w.admin, NOTE)).status).toBe(
      404,
    );
  });
});
