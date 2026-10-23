import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import { day, documentReviewApi } from './document-review.testing';

const { accept, prisma, refuse, world } = documentReviewApi();

const reader = countedMetrics();
const refused = () =>
  counterTotal(reader, 'motorfix_document_cycle_total', { step: 'refused' });

const NOTE = { note: 'Certificatul este ilizibil', reason: 'documents' };

// @traces 068-FR-010
// @traces 068-FR-013
describe('refusing a yearly document', () => {
  it('marks it refused with the reason, the note and the admin, keeping the earlier valid one', async () => {
    const w = await world();
    const before = await refused();

    const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, {
      note: '  Certificatul este ilizibil  ',
      reason: 'documents',
    });

    expect(answer.status).toBe(200);
    const document = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(document).toMatchObject({
      decidedBy: w.ana,
      refusalNote: 'Certificatul este ilizibil',
      refusalReason: 'documents',
      replacedAt: null,
      status: 'refused',
    });
    expect(document.decidedAt).not.toBeNull();
    const earlier = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.old.onrc_certificate.id },
    });
    expect([earlier.status, earlier.replacedAt]).toEqual(['valid', null]);
    expect((await refused()) - before).toBe(1);
  });

  it('leaves the due date, the state and the grace as they were', async () => {
    const w = await world({
      dueOn: '2026-10-01',
      graceUntil: '2026-10-15',
      state: 'overdue',
    });
    await accept(w.fresh.rar_authorisation.id, w.admin);

    const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, NOTE);

    expect(answer.body).toEqual({
      cycle: {
        canUpload: true,
        dueOn: '2026-10-01',
        graceUntil: '2026-10-15',
        inReview: false,
        refusal: {
          decidedAt: expect.any(String),
          kind: 'onrc_certificate',
          note: 'Certificatul este ilizibil',
          reason: 'documents',
        },
        row: 'overdue',
        state: 'overdue',
      },
      document: {
        decidedAt: expect.any(String),
        id: w.fresh.onrc_certificate.id,
        kind: 'onrc_certificate',
        status: 'refused',
      },
      suspendedFor: null,
    });
    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect([
      day(cycle.dueOn),
      cycle.state,
      day(cycle.graceUntil),
      cycle.resetAt,
      cycle.reminded30At,
    ]).toEqual([
      '2026-10-01',
      'overdue',
      '2026-10-15',
      w.cycle.resetAt,
      w.cycle.reminded30At,
    ]);
  });

  it('writes its history entry and one document.refused event to the admins and the garage', async () => {
    const w = await world();

    await refuse(w.fresh.rar_authorisation.id, w.admin, {
      note: 'Autorizația a expirat',
      reason: 'other',
    });

    const history = await prisma.activityLog.findMany({
      where: {
        subjectId: w.fresh.rar_authorisation.id,
        subjectType: 'legal_document',
      },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'update',
      actorId: w.ana,
      actorRole: 'admin',
      field: 'status',
      garageId: w.dinamo.id,
      newValue: {
        note: 'Autorizația a expirat',
        reason: 'other',
        status: 'refused',
      },
      oldValue: 'in_review',
    });
    const events = await prisma.outboxEvent.findMany({
      where: {
        kind: 'document.refused',
        subjectId: w.fresh.rar_authorisation.id,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.subjectId).toBe(w.fresh.rar_authorisation.id);
    expect(events[0]?.audience).toEqual(['admin', `garage:${w.dinamo.id}`]);
    expect(events[0]?.payload).toEqual({
      documentId: w.fresh.rar_authorisation.id,
      garageId: w.dinamo.id,
      kind: 'rar_authorisation',
      reason: 'other',
    });
  });

  it.each([
    [{ note: 'Notă' }],
    [{ note: 'Notă', reason: 'expired' }],
    [{ reason: 'other' }],
    [{ note: '   ', reason: 'other' }],
    [{ note: 'a'.repeat(501), reason: 'other' }],
    [{ note: 'Notă\u0007', reason: 'other' }],
  ])('refuses %j with 400, changing nothing', async (body) => {
    const w = await world();

    const answer = await refuse(w.fresh.onrc_certificate.id, w.admin, body);

    expect(answer.status).toBe(400);
    const document = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(document.status).toBe('in_review');
  });
});

describe('who may refuse, and what', () => {
  it('refuses a document no longer in review, changing nothing', async () => {
    const w = await world();
    await refuse(w.fresh.onrc_certificate.id, w.admin, NOTE);

    for (const id of [
      w.fresh.onrc_certificate.id,
      w.old.rar_authorisation.id,
    ]) {
      const answer = await refuse(id, w.admin, NOTE);
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('document_not_in_review');
    }
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: 'document.refused',
          subjectId: {
            in: [w.fresh.onrc_certificate.id, w.old.rar_authorisation.id],
          },
        },
      }),
    ).toBe(1);
  });

  it('answers 404 for an unknown id and to anyone not an admin', async () => {
    const w = await world();

    expect(
      (await refuse('5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1000', w.admin, NOTE))
        .status,
    ).toBe(404);
    for (const as of [w.owner, w.driver]) {
      expect((await refuse(w.fresh.onrc_certificate.id, as, NOTE)).status).toBe(
        404,
      );
    }
    const document = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(document.status).toBe('in_review');
  });
});
