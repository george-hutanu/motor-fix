import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { DocumentCycleStep } from './document-cycle.step';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

// @traces 068-FR-003
// @traces 068-FR-013
// @traces 068-FR-014
// @traces 068-FR-016
// @traces 068-FR-017

const reader = countedMetrics();
const counted = (step: string) =>
  counterTotal(reader, 'motorfix_document_cycle_total', { step });
const overdueGauge = () => counterTotal(reader, 'motorfix_documents_overdue');

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

// 09:00 in Bucharest on 23 October 2026.
const NOW = new Date('2026-10-23T06:00:00Z');
const step = new DocumentCycleStep(prisma);

afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  await reset();
});
afterEach(() => jest.restoreAllMocks());

const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);

async function cycleDue(
  dueOn: string,
  extra: {
    state?: 'due' | 'overdue';
    reminded30At?: Date;
    inReview?: boolean;
  } = {},
) {
  const garage = await prisma.garage.create({
    data: {
      approvedAt: new Date('2025-10-01T10:00:00Z'),
      name: 'Atelier',
      slug: `cycle-${randomUUID()}`,
      status: 'approved',
    },
  });
  await prisma.verificationFile.create({
    data: {
      documents: {
        create: [
          { kind: 'onrc_certificate', pages: ['p1'] },
          { kind: 'rar_authorisation', pages: ['p1'] },
          ...(extra.inReview
            ? [
                {
                  kind: 'rar_authorisation',
                  pages: ['p2'],
                  status: 'in_review',
                },
              ]
            : []),
        ],
      },
      garageId: garage.id,
      status: 'approved',
    },
  });
  return prisma.documentCycle.create({
    data: {
      dueOn: new Date(dueOn),
      garageId: garage.id,
      reminded30At: extra.reminded30At,
      state: extra.state ?? 'due',
    },
  });
}

const cycleOf = (id: string) =>
  prisma.documentCycle.findUniqueOrThrow({ where: { id } });
const marks = async (id: string) => {
  const cycle = await cycleOf(id);
  return [cycle.reminded30At, cycle.reminded7At, cycle.reminded0At].map(
    (at) => at !== null,
  );
};
const events = (subjectId: string, kind?: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { subjectId, ...(kind && { kind }) },
  });

describe('the daily compliance step', () => {
  it('sends the 30-day reminder once from 30 days before the due date', async () => {
    const cycle = await cycleDue('2026-11-22');
    const before = await counted('reminded_30');

    await step.run(NOW);
    await step.run(new Date('2026-10-23T14:00:00Z'));

    expect(await marks(cycle.id)).toEqual([true, false, false]);
    const due = await events(cycle.id);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      audience: [`garage:${cycle.garageId}`],
      kind: 'document.due',
      payload: { dueOn: '2026-11-22', garageId: cycle.garageId, stage: 30 },
    });
    expect((await counted('reminded_30')) - before).toBe(1);
  });

  it('sends nothing 31 days before the due date', async () => {
    const cycle = await cycleDue('2026-11-23');

    await step.run(NOW);

    expect(await marks(cycle.id)).toEqual([false, false, false]);
    expect(await events(cycle.id)).toEqual([]);
  });

  it('sends the 30-day reminder up to 8 days before and the 7-day one from 7 days', async () => {
    const eight = await cycleDue('2026-10-31');
    const seven = await cycleDue('2026-10-30', {
      reminded30At: new Date('2026-10-01T06:00:00Z'),
    });

    await step.run(NOW);

    expect((await events(eight.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-31', garageId: eight.garageId, stage: 30 },
    ]);
    expect((await events(seven.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-30', garageId: seven.garageId, stage: 7 },
    ]);
    expect(await marks(seven.id)).toEqual([true, true, false]);
  });

  it('sends only the latest missed reminder, marking the earlier ones silently', async () => {
    const week = await cycleDue('2026-10-25');
    const today = await cycleDue('2026-10-23');

    await step.run(NOW);

    expect((await events(week.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-25', garageId: week.garageId, stage: 7 },
    ]);
    expect(await marks(week.id)).toEqual([true, true, false]);
    expect((await events(today.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-23', garageId: today.garageId, stage: 0 },
    ]);
    expect(await marks(today.id)).toEqual([true, true, true]);
  });

  it('writes each reminder once when two runs overlap', async () => {
    const cycle = await cycleDue('2026-10-25');
    const before = await counted('reminded_7');

    await Promise.all([step.run(NOW), step.run(NOW), step.run(NOW)]);

    expect(await events(cycle.id)).toHaveLength(1);
    expect((await counted('reminded_7')) - before).toBe(1);
  });

  it('turns the cycle overdue the day after its due date, with 14 days of grace, its history and its event', async () => {
    const cycle = await cycleDue('2026-10-22');
    const before = await counted('overdue');

    await step.run(NOW);

    const after = await cycleOf(cycle.id);
    expect([after.state, day(after.graceUntil)]).toEqual([
      'overdue',
      '2026-11-05',
    ]);
    const history = await prisma.activityLog.findMany({
      where: { garageId: cycle.garageId, kind: 'documents_overdue' },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'update',
      actorId: null,
      actorName: 'MotorFix',
      actorRole: 'system',
      field: 'documents_state',
      newValue: { graceUntil: '2026-11-05', state: 'overdue' },
      oldValue: { state: 'due' },
      subjectId: cycle.garageId,
      subjectType: 'garage',
    });
    const overdue = await events(cycle.id, 'document.overdue');
    expect(overdue.map((e) => e.audience)).toEqual([
      [`garage:${cycle.garageId}`],
      ['admin'],
    ]);
    for (const event of overdue) {
      expect(event.payload).toEqual({
        dueOn: '2026-10-22',
        garageId: cycle.garageId,
        graceUntil: '2026-11-05',
      });
    }
    expect(await events(cycle.id, 'document.due')).toEqual([]);
    expect((await counted('overdue')) - before).toBe(1);
  });

  it('never suspends the garage, and changes nothing on a second run', async () => {
    const cycle = await cycleDue('2026-10-10');

    await step.run(NOW);
    const first = await cycleOf(cycle.id);
    await step.run(new Date('2026-10-24T06:00:00Z'));

    expect(await cycleOf(cycle.id)).toEqual(first);
    expect(day(first.graceUntil)).toBe('2026-10-24');
    expect(await events(cycle.id)).toHaveLength(2);
    expect(
      await prisma.garageSuspension.count({
        where: { garageId: cycle.garageId },
      }),
    ).toBe(0);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: cycle.garageId },
    });
    expect(garage.status).toBe('approved');
  });

  it('sends no reminder once the cycle is overdue', async () => {
    const cycle = await cycleDue('2026-10-10', { state: 'overdue' });

    await step.run(NOW);

    expect(await events(cycle.id)).toEqual([]);
    expect(await marks(cycle.id)).toEqual([false, false, false]);
  });

  it('sends no reminder while a document is in review, but still turns the cycle overdue', async () => {
    const waiting = await cycleDue('2026-10-25', { inReview: true });
    const late = await cycleDue('2026-10-22', { inReview: true });

    await step.run(NOW);

    expect(await events(waiting.id)).toEqual([]);
    expect(await marks(waiting.id)).toEqual([false, false, false]);
    const after = await cycleOf(late.id);
    expect([after.state, day(after.graceUntil)]).toEqual([
      'overdue',
      '2026-11-05',
    ]);
    expect(await events(late.id, 'document.due')).toEqual([]);
    expect(await events(late.id, 'document.overdue')).toHaveLength(2);
  });

  it('reports the overdue cycles and logs one line for the run', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    await cycleDue('2026-10-01', { state: 'overdue' });
    await cycleDue('2026-10-22');
    await cycleDue('2026-11-20');

    await step.run(NOW);

    expect(await overdueGauge()).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '2026-10-23: reminders 30=1 7=0 0=0, overdue 1',
    );
  });
});
