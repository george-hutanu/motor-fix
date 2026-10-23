import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import { day, documentReviewApi } from './document-review.testing';
import { addMonths, localDay } from '../../../bucharest';

const { accept, prisma, world } = documentReviewApi();

const reader = countedMetrics();
const accepted = () =>
  counterTotal(reader, 'motorfix_document_cycle_total', { step: 'accepted' });

const today = () => localDay(new Date());

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'document.accepted', subjectId },
  });

// @traces 068-FR-009
// @traces 068-FR-013
// @traces 068-FR-014
describe('accepting a yearly document', () => {
  it('makes it the valid document of its kind, decided by the admin, and marks the earlier one replaced', async () => {
    const w = await world();
    const before = await accepted();

    const answer = await accept(w.fresh.onrc_certificate.id, w.admin);

    expect(answer.status).toBe(200);
    const document = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(document.status).toBe('valid');
    expect(document.decidedBy).toBe(w.ana);
    expect(document.decidedAt).not.toBeNull();
    expect(document.replacedAt).toBeNull();
    const earlier = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.old.onrc_certificate.id },
    });
    expect(earlier.status).toBe('valid');
    expect(earlier.replacedAt).not.toBeNull();
    const other = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.old.rar_authorisation.id },
    });
    expect(other.replacedAt).toBeNull();
    expect((await accepted()) - before).toBe(1);
  });

  it('writes its history entry and one document.accepted event to the admins and the garage', async () => {
    const w = await world();

    await accept(w.fresh.onrc_certificate.id, w.admin);

    const history = await prisma.activityLog.findMany({
      where: {
        subjectId: w.fresh.onrc_certificate.id,
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
      newValue: 'valid',
      oldValue: 'in_review',
    });
    const event = await events(w.fresh.onrc_certificate.id);
    expect(event).toHaveLength(1);
    expect(event[0]?.audience).toEqual(['admin', `garage:${w.dinamo.id}`]);
    expect(event[0]?.payload).toEqual({
      documentId: w.fresh.onrc_certificate.id,
      dueOn: '2026-11-01',
      garageId: w.dinamo.id,
      kind: 'onrc_certificate',
    });
  });

  it('leaves the cycle as it was while the other kind is not accepted since the last reset', async () => {
    const w = await world({
      dueOn: '2026-10-01',
      graceUntil: '2026-10-15',
      state: 'overdue',
    });

    const answer = await accept(w.fresh.onrc_certificate.id, w.admin);

    expect(answer.body).toEqual({
      cycle: {
        canUpload: false,
        dueOn: '2026-10-01',
        graceUntil: '2026-10-15',
        inReview: true,
        refusal: null,
        row: 'in_review',
        state: 'overdue',
      },
      document: {
        decidedAt: expect.any(String),
        id: w.fresh.onrc_certificate.id,
        kind: 'onrc_certificate',
        status: 'valid',
      },
      suspendedFor: null,
    });
    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect(cycle.resetAt).toEqual(w.cycle.resetAt);
    expect(cycle.reminded30At).not.toBeNull();
    expect(
      await prisma.activityLog.count({
        where: { field: 'documents_due_on', garageId: w.dinamo.id },
      }),
    ).toBe(0);
  });

  it('resets the cycle a year from the acceptance once both kinds are accepted, with its history entry', async () => {
    const w = await world({
      dueOn: '2026-10-01',
      graceUntil: '2026-10-15',
      state: 'overdue',
    });
    await accept(w.fresh.onrc_certificate.id, w.admin);
    const started = new Date();

    const answer = await accept(w.fresh.rar_authorisation.id, w.admin);

    const dueOn = addMonths(today(), 12);
    expect(answer.status).toBe(200);
    expect(answer.body.cycle).toEqual({
      canUpload: true,
      dueOn,
      graceUntil: null,
      inReview: false,
      refusal: null,
      row: 'valid',
      state: 'due',
    });
    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { id: w.cycle.id },
    });
    expect([day(cycle.dueOn), cycle.state, cycle.graceUntil]).toEqual([
      dueOn,
      'due',
      null,
    ]);
    expect([cycle.reminded30At, cycle.reminded7At, cycle.reminded0At]).toEqual([
      null,
      null,
      null,
    ]);
    expect(cycle.resetAt.getTime()).toBeGreaterThanOrEqual(
      started.getTime() - 1000,
    );
    const history = await prisma.activityLog.findMany({
      where: { field: 'documents_due_on', garageId: w.dinamo.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'update',
      actorId: w.ana,
      actorRole: 'admin',
      newValue: dueOn,
      oldValue: '2026-10-01',
      subjectId: w.dinamo.id,
      subjectType: 'garage',
    });
    expect((await events(w.fresh.rar_authorisation.id))[0]?.payload).toEqual({
      documentId: w.fresh.rar_authorisation.id,
      dueOn,
      garageId: w.dinamo.id,
      kind: 'rar_authorisation',
    });
  });

  it('does not count an acceptance from before the last reset', async () => {
    const w = await world();
    await prisma.legalDocument.update({
      data: {
        decidedAt: new Date('2025-10-31T09:00:00Z'),
        decidedBy: w.ana,
      },
      where: { id: w.old.rar_authorisation.id },
    });
    await prisma.legalDocument.delete({
      where: { id: w.fresh.rar_authorisation.id },
    });

    const answer = await accept(w.fresh.onrc_certificate.id, w.admin);

    expect(answer.body.cycle.dueOn).toBe('2026-11-01');
  });

  it('carries the cause of an open suspension, for the way back to the map', async () => {
    const w = await world({
      dueOn: '2026-09-01',
      graceUntil: '2026-09-15',
      state: 'overdue',
    });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: w.dinamo.id },
    });
    await prisma.garageSuspension.create({
      data: {
        cause: 'documents_overdue',
        fromTime: new Date('2026-09-16T06:00:00Z'),
        garageId: w.dinamo.id,
        reason: 'Documente restante',
      },
    });
    await accept(w.fresh.onrc_certificate.id, w.admin);

    const answer = await accept(w.fresh.rar_authorisation.id, w.admin);

    expect(answer.body.suspendedFor).toBe('documents_overdue');
    expect(answer.body.cycle.state).toBe('due');
    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id: w.dinamo.id } }))
        .status,
    ).toBe('suspended');
  });

  it('waits for the cycle while a compliance step holds it', async () => {
    const w = await world();
    let settled = false;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      void prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM garage_document_cycle WHERE id = ${w.cycle.id}::uuid FOR UPDATE`;
          resolve();
          await held;
        },
        { timeout: 10_000 },
      );
    });
    await locked;

    const call = accept(w.fresh.onrc_certificate.id, w.admin).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false);
    release();

    expect((await call).status).toBe(200);
  });
});

describe('who may accept, and what', () => {
  it('refuses a document no longer in review, changing nothing', async () => {
    const w = await world();
    await accept(w.fresh.onrc_certificate.id, w.admin);

    for (const id of [
      w.fresh.onrc_certificate.id,
      w.old.rar_authorisation.id,
    ]) {
      const answer = await accept(id, w.admin);
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('document_not_in_review');
    }
    expect(await events(w.old.rar_authorisation.id)).toEqual([]);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    const w = await world();

    expect(
      (await accept('5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1000', w.admin)).status,
    ).toBe(404);
    expect((await accept('not-a-uuid', w.admin)).status).toBe(404);
  });

  it('answers 404 to anyone not an admin, the owner included', async () => {
    const w = await world();

    for (const as of [w.owner, w.driver]) {
      expect((await accept(w.fresh.onrc_certificate.id, as)).status).toBe(404);
    }
    const document = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: w.fresh.onrc_certificate.id },
    });
    expect(document.status).toBe('in_review');
  });
});
