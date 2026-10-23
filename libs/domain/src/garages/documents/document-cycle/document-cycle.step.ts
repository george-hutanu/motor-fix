import { DOCUMENT_GRACE_DAYS } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import { reportDocumentsOverdue } from './document-cycle.gauge';
import { dayOf, inReviewWhere } from './document-cycle.service';
import { AuditService } from '../../../audit/audit.service';
import { addDays, daysBetween, localDay } from '../../../bucharest';
import { outbox } from '../../../events/event.port';
import type {
  DocumentCycle,
  Prisma,
  PrismaClient,
} from '../../../generated/prisma/client';
import { countDocumentCycle } from '../../../metrics/product-counters';
import type { DailyTask } from '../../../scheduler/daily';

// The reminders, earliest first, each with its mark and how many days
// before the due date it starts.
const STAGES = [
  { days: 30, mark: 'reminded30At' },
  { days: 7, mark: 'reminded7At' },
  { days: 0, mark: 'reminded0At' },
] as const;
type Stage = (typeof STAGES)[number]['days'];

// What one cycle's pass did.
type Done = Stage | 'overdue' | null;

// Each morning, every cycle still due: its reminder from 30, 7 and 0 days
// before the due date, and the day after it, overdue with its grace. Every
// move is read from the due date and the marks, so a missed morning is
// caught up, and each cycle is locked while it moves, so a second run, at
// once or later, does nothing again. Only the latest reminder a pass reaches
// is written; the earlier marks are set with it. Nothing is said while a
// document is in review, though the cycle still turns overdue. Taking the
// garage off the map at the end of the grace is not this step's.
export class DocumentCycleStep implements DailyTask {
  private readonly logger = new Logger('DocumentCycle');
  private readonly audit = new AuditService();

  constructor(private readonly prisma: PrismaClient) {}

  async run(now: Date): Promise<void> {
    const today = localDay(now);
    const cycles = await this.prisma.documentCycle.findMany({
      select: { id: true },
      where: {
        dueOn: { lte: new Date(addDays(today, STAGES[0].days)) },
        state: 'due',
      },
    });
    const done: Done[] = [];
    const errors: unknown[] = [];
    for (const { id } of cycles) {
      try {
        done.push(
          await this.prisma.$transaction((tx) => this.pass(tx, id, today, now)),
        );
      } catch (error) {
        errors.push(error);
        this.logger.error(`cycle ${id} failed: ${(error as Error).message}`);
      }
    }
    await this.report(today, done);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `${errors.length} cycles failed`);
    }
  }

  // Counts what the run did, reports the overdue cycles, and logs one line.
  private async report(today: string, done: Done[]) {
    for (const one of done) {
      if (one !== null) {
        countDocumentCycle(one === 'overdue' ? one : `reminded_${one}`);
      }
    }
    reportDocumentsOverdue(
      await this.prisma.documentCycle.count({ where: { state: 'overdue' } }),
    );
    const sent = (one: Done) => done.filter((d) => d === one).length;
    this.logger.log(
      `${today}: reminders 30=${sent(30)} 7=${sent(7)} 0=${sent(0)}, overdue ${sent('overdue')}`,
    );
  }

  private async pass(
    tx: Prisma.TransactionClient,
    id: string,
    today: string,
    now: Date,
  ): Promise<Done> {
    await tx.$queryRaw`
      SELECT 1 FROM garage_document_cycle WHERE id = ${id}::uuid FOR UPDATE`;
    const cycle = await tx.documentCycle.findUniqueOrThrow({ where: { id } });
    if (cycle.state !== 'due') return null;
    const dueOn = dayOf(cycle.dueOn);
    const days = daysBetween(today, dueOn);
    if (days < 0) {
      await this.overdue(tx, cycle, dueOn);
      return 'overdue';
    }
    const reached = STAGES.findLastIndex((stage) => days <= stage.days);
    const stage = STAGES[reached];
    if (!stage || cycle[stage.mark]) return null;
    if (
      await tx.legalDocument.count({ where: inReviewWhere(cycle.garageId) })
    ) {
      return null;
    }
    const marks = STAGES.slice(0, reached + 1).filter(
      ({ mark }) => !cycle[mark],
    );
    await tx.documentCycle.update({
      data: Object.fromEntries(marks.map(({ mark }) => [mark, now])),
      where: { id },
    });
    await outbox.record(tx, {
      audience: { garageIds: [cycle.garageId], type: 'garage' },
      kind: 'document.due',
      payload: { dueOn, garageId: cycle.garageId, stage: stage.days },
      subjectId: id,
    });
    return stage.days;
  }

  private async overdue(
    tx: Prisma.TransactionClient,
    cycle: DocumentCycle,
    dueOn: string,
  ) {
    const graceUntil = addDays(dueOn, DOCUMENT_GRACE_DAYS);
    const { garageId } = cycle;
    await tx.documentCycle.update({
      data: { graceUntil: new Date(graceUntil), state: 'overdue' },
      where: { id: cycle.id },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'documents_state',
      garageId,
      kind: 'documents_overdue',
      newValue: { graceUntil, state: 'overdue' },
      oldValue: { state: 'due' },
      subjectId: garageId,
      subjectType: 'garage',
    });
    for (const audience of [
      { garageIds: [garageId], type: 'garage' },
      { adminOnly: true, type: 'platform' },
    ] as const) {
      await outbox.record(tx, {
        audience,
        kind: 'document.overdue',
        payload: { dueOn, garageId, graceUntil },
        subjectId: cycle.id,
      });
    }
  }
}
