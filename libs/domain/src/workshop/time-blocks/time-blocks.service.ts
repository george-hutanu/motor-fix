import {
  type CreateTimeBlockDto,
  TIME_BLOCK_NOTE_MAX,
  type TimeBlockDto,
  type TimeBlockOptionsDto,
  type TimeBlocksDto,
  type UpdateTimeBlockDto,
} from '@motor-fix/contracts';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  announced,
  blocksOf,
  removedValues,
  type Shape,
  segmentRows,
  segmentsAt,
  storedInclude,
  timeBlockOf,
  valuesOf,
} from './time-blocks';
import {
  AUDIT_PORT,
  type AuditChange,
  type AuditPort,
} from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, assertGarage, forbidden } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import {
  addDays,
  addLocalDays,
  atLocal,
  daysBetween,
  localDay,
} from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import {
  garageOptions,
  switchesOf,
} from '../../garages/features/garage-options';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  deadlockRetried,
  isSlotTaken,
  ScheduleService,
} from '../schedule/schedule.service';

type Tx = Prisma.TransactionClient;

const MAX_LIST_DAYS = 31;

const MAX_DAYS = 14;
const QUARTER = 15;
const MINUTE = 60_000;

// A block of another garage, unknown or not even an id.
export const blockNotFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such blocked interval');

const invalid = (field: keyof Shape, message: string) =>
  refusal(HttpStatus.UNPROCESSABLE_ENTITY, 'validation_failed', message, [
    { code: 'invalid', field },
  ]);

const onGrid = (at: Date) =>
  at.getUTCMinutes() % QUARTER === 0 &&
  at.getUTCSeconds() === 0 &&
  at.getUTCMilliseconds() === 0;

// Trimmed; an empty note is none.
const cleaned = (note: string | null | undefined) => {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

// What a block holds: a mechanic or a lift, each only while its switch is
// on, and something while either is.
function judgeSwitches(
  asked: Shape,
  { lifts, team }: { lifts: boolean; team: boolean },
  en: boolean,
) {
  if ((!team && !lifts) || (!asked.mechanicId && asked.lift === null)) {
    throw refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'nothing_to_block',
      en
        ? 'Nothing to block: switch the team or the lifts on'
        : 'Nu e nimic de blocat: pornește echipa sau elevatoarele',
    );
  }
  if (asked.mechanicId && !team) {
    throw refusal(
      HttpStatus.NOT_FOUND,
      'feature_off',
      'This garage does not take mechanics',
    );
  }
  if (asked.lift !== null && !lifts) {
    throw refusal(
      HttpStatus.NOT_FOUND,
      'feature_off',
      'This garage schedules without lifts',
    );
  }
}

// On the quarter-hour grid, 15 minutes to 14 days long, and not over yet.
function judgeRange({ startsAt, endsAt }: Shape, en: boolean) {
  const now = new Date();
  if (!onGrid(startsAt)) {
    throw invalid('startsAt', 'startsAt must be on a quarter hour');
  }
  if (!onGrid(endsAt)) {
    throw invalid('endsAt', 'endsAt must be on a quarter hour');
  }
  if ((endsAt.getTime() - startsAt.getTime()) / MINUTE < QUARTER) {
    throw invalid(
      'endsAt',
      'endsAt must be at least 15 minutes after startsAt',
    );
  }
  if (endsAt > addLocalDays(startsAt, MAX_DAYS)) {
    throw invalid('endsAt', `a block lasts at most ${MAX_DAYS} days`);
  }
  if (endsAt <= now) {
    throw invalid(
      'endsAt',
      en ? 'The interval has already ended' : 'Intervalul s-a încheiat deja',
    );
  }
}

// The given fields over the stored block; null clears a field.
function applied(stored: Shape, dto: UpdateTimeBlockDto): Shape {
  const given = <T>(value: T | undefined, kept: T) =>
    value === undefined ? kept : value;
  return {
    endsAt: dto.endsAt ? new Date(dto.endsAt) : stored.endsAt,
    lift: given(dto.lift, stored.lift),
    mechanicId: given(dto.mechanicId, stored.mechanicId),
    note: given(dto.note, stored.note),
    startsAt: dto.startsAt ? new Date(dto.startsAt) : stored.startsAt,
  };
}

// Whether a change moves the block's segments: its mechanic, lift or range.
const movedFrom = (stored: Shape, shape: Shape) =>
  shape.mechanicId !== stored.mechanicId ||
  shape.lift !== stored.lift ||
  shape.startsAt.getTime() !== stored.startsAt.getTime() ||
  shape.endsAt.getTime() !== stored.endsAt.getTime();

// Time the garage holds on a mechanic, a lift or both, for a walk-in or a
// phone booking: the owner and the front desk block it, change it and free it.
@Injectable()
export class TimeBlocksService {
  private readonly logger = new Logger('TimeBlocks');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly schedule: ScheduleService,
  ) {}

  list(
    actor: Actor,
    garageId: string,
    query: { from?: string; to?: string },
  ): Promise<TimeBlocksDto> {
    return this.logged(garageId, undefined, async () => {
      this.assertDesk(actor, garageId);
      const from = query.from ?? localDay(new Date());
      const to = query.to ?? from;
      const span = daysBetween(from, to);
      if (!(span >= 0 && span < MAX_LIST_DAYS)) {
        throw new BadRequestException({
          code: 'validation_failed',
          message: `from and to span 1 to ${MAX_LIST_DAYS} days`,
        });
      }
      const { lifts } = await switchesOf(this.prisma, garageId);
      const blocks = await blocksOf(
        this.prisma,
        {
          end: atLocal(addDays(to, 1), 0),
          garageId,
          start: atLocal(from, 0),
        },
        lifts,
      );
      return { blocks, from, lifts, to };
    });
  }

  // What the block dialog may offer; it reads, it writes nothing.
  options(actor: Actor, garageId: string): Promise<TimeBlockOptionsDto> {
    return this.logged(garageId, undefined, async () => {
      this.assertDesk(actor, garageId);
      const { liftCount, mechanics } = await garageOptions(
        this.prisma,
        garageId,
      );
      return { liftCount, mechanics };
    });
  }

  create(
    actor: Actor,
    garageId: string,
    dto: CreateTimeBlockDto,
  ): Promise<TimeBlockDto> {
    return this.logged(garageId, undefined, () => {
      this.assertDesk(actor, garageId);
      return this.written(actor, async (tx) => {
        const asked: Shape = {
          endsAt: new Date(dto.endsAt),
          lift: dto.lift ?? null,
          mechanicId: dto.mechanicId ?? null,
          note: dto.note ?? null,
          startsAt: new Date(dto.startsAt),
        };
        const { lifts, mechanicName, shape } = await this.judged(
          tx,
          actor,
          garageId,
          asked,
        );
        await this.assertFree(tx, actor, garageId, shape, mechanicName);
        const block = await tx.timeBlock.create({
          data: {
            createdBy: actor.accountId,
            endsAt: shape.endsAt,
            garageId,
            lift: shape.lift,
            mechanicId: shape.mechanicId,
            note: shape.note,
            startsAt: shape.startsAt,
            updatedBy: actor.accountId,
          },
        });
        await tx.bookingSegment.createMany({
          data: segmentRows(shape, garageId, block.id),
        });
        await this.audit.record(tx, {
          ...this.entry(actor, garageId, block.id),
          action: 'create',
          newValue: { ...valuesOf(shape), mechanicName, note: shape.note },
          oldValue: null,
        });
        await announced(
          this.events,
          tx,
          'time_block.created',
          garageId,
          block.id,
          shape,
        );
        return this.read(tx, block.id, lifts);
      });
    });
  }

  update(
    actor: Actor,
    garageId: string,
    blockId: string,
    dto: UpdateTimeBlockDto,
  ): Promise<TimeBlockDto> {
    return this.logged(garageId, blockId, () => {
      this.assertDesk(actor, garageId);
      return this.written(actor, async (tx) => {
        const stored = await this.locked(tx, actor, garageId, blockId);
        const { lifts, mechanicName, shape } = await this.judged(
          tx,
          actor,
          garageId,
          applied(stored, dto),
        );
        const moved = movedFrom(stored, shape);
        if (!moved && shape.note === stored.note) {
          return this.read(tx, blockId, lifts);
        }
        if (moved) {
          await this.assertFree(
            tx,
            actor,
            garageId,
            shape,
            mechanicName,
            blockId,
          );
          await tx.bookingSegment.deleteMany({
            where: { timeBlockId: blockId },
          });
        }
        await tx.timeBlock.update({
          data: { ...shape, updatedBy: actor.accountId },
          where: { id: blockId },
        });
        if (moved) {
          await tx.bookingSegment.createMany({
            data: segmentRows(shape, garageId, blockId),
          });
        }
        await this.audit.recordChanges(
          tx,
          this.entry(actor, garageId, blockId),
          { ...valuesOf(stored), note: stored.note },
          { ...valuesOf(shape), note: shape.note },
        );
        await announced(
          this.events,
          tx,
          'time_block.updated',
          garageId,
          blockId,
          shape,
        );
        return this.read(tx, blockId, lifts);
      });
    });
  }

  remove(actor: Actor, garageId: string, blockId: string): Promise<void> {
    return this.logged(garageId, blockId, () => {
      this.assertDesk(actor, garageId);
      return this.written(actor, async (tx) => {
        const stored = await this.locked(tx, actor, garageId, blockId);
        await tx.timeBlock.delete({ where: { id: blockId } });
        await this.audit.record(tx, {
          ...this.entry(actor, garageId, blockId),
          action: 'delete',
          newValue: null,
          oldValue: removedValues(stored),
        });
        await announced(
          this.events,
          tx,
          'time_block.deleted',
          garageId,
          blockId,
          stored,
        );
      });
    });
  }

  // The owner and the front desk of the garage; a mechanic of it is told no
  // whatever her rights, anyone else finds no garage.
  private assertDesk(actor: Actor, garageId: string) {
    assertGarage(actor, garageId);
    if (actor.role === 'mechanic') {
      throw forbidden(
        actor.language === 'en'
          ? 'Only the owner or the front desk blocks time'
          : 'Doar proprietarul sau recepția blochează timp',
      );
    }
  }

  // One log line per refusal: the code, the garage and the block, never the
  // note.
  private async logged<T>(
    garageId: string,
    blockId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        const body = error.getResponse() as { code?: string };
        this.logger.warn({
          blockId,
          code: body.code ?? error.getStatus(),
          garageId,
        });
      }
      throw error;
    }
  }

  // The write in one transaction; a deadlock on the exclusion constraints
  // runs it again, and an overlap the database refused is 409 slot_taken.
  private async written<T>(
    actor: Actor,
    write: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await deadlockRetried(() => this.prisma.$transaction(write));
    } catch (error) {
      if (!isSlotTaken(error)) throw error;
      throw refusal(
        HttpStatus.CONFLICT,
        'slot_taken',
        actor.language === 'en'
          ? 'The slot was just taken'
          : 'Locul tocmai a fost ocupat',
      );
    }
  }

  // The block, held for this change: another change or removal waits here
  // and is judged on what this one left. Ended blocks stay as they were.
  private async locked(tx: Tx, actor: Actor, garageId: string, id: string) {
    await tx.$queryRaw`
      SELECT id FROM time_block
      WHERE id = ${id}::uuid AND garage_id = ${garageId}::uuid FOR UPDATE`;
    const stored = await tx.timeBlock.findFirst({
      include: { mechanic: { select: { name: true } } },
      where: { garageId, id },
    });
    if (!stored) throw blockNotFound();
    if (stored.endsAt <= new Date()) {
      throw refusal(
        HttpStatus.CONFLICT,
        'block_past',
        actor.language === 'en'
          ? 'A past blocked interval can no longer be changed'
          : 'Un interval blocat trecut nu se mai poate modifica',
      );
    }
    return stored;
  }

  // The refusals in their order, before any write; the card is
  // read FOR SHARE so its removal waits for this block, or this block for it.
  private async judged(tx: Tx, actor: Actor, garageId: string, asked: Shape) {
    const switches = await switchesOf(tx, garageId);
    judgeSwitches(asked, switches, actor.language === 'en');
    const mechanicName = asked.mechanicId
      ? await this.cardName(tx, garageId, asked.mechanicId)
      : null;
    if (asked.lift !== null) {
      const { liftCount } = await tx.garage.findUniqueOrThrow({
        select: { liftCount: true },
        where: { id: garageId },
      });
      if (asked.lift < 1 || asked.lift > liftCount) {
        throw invalid('lift', `lift must be from 1 to ${liftCount}`);
      }
    }
    judgeRange(asked, actor.language === 'en');
    const note = cleaned(asked.note);
    // PostgreSQL text holds no NUL character: refused, not a 500.
    if (note?.includes('\u0000')) {
      throw invalid('note', 'note must not hold a NUL character');
    }
    if (note !== null && [...note].length > TIME_BLOCK_NOTE_MAX) {
      throw invalid(
        'note',
        `note must be at most ${TIME_BLOCK_NOTE_MAX} characters`,
      );
    }
    return {
      lifts: switches.lifts,
      mechanicName,
      shape: { ...asked, note },
    };
  }

  // A current card of this garage, the owner's own row included.
  private async cardName(tx: Tx, garageId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM mechanic WHERE id = ${id}::uuid FOR SHARE`;
    const card = await tx.mechanic.findFirst({
      select: { name: true },
      where: { garageId, id, removedAt: null },
    });
    if (!card) {
      throw invalid('mechanicId', 'mechanicId is not a card of this garage');
    }
    return card.name;
  }

  private assertFree(
    tx: Tx,
    actor: Actor,
    garageId: string,
    shape: Shape,
    mechanicName: string | null,
    exceptTimeBlockId?: string,
  ) {
    return this.schedule.assertFree(tx, {
      exceptTimeBlockId,
      garageId,
      language: actor.language === 'en' ? 'en' : 'ro',
      lift: shape.lift,
      mechanicId: shape.mechanicId,
      mechanicName: mechanicName ?? '',
      segments: segmentsAt(shape),
      startsAt: shape.startsAt,
    });
  }

  private entry(actor: Actor, garageId: string, blockId: string): AuditChange {
    return {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      internal: true,
      subjectId: blockId,
      subjectType: 'time_block',
    };
  }

  private async read(tx: Tx, id: string, lifts: boolean) {
    const row = await tx.timeBlock.findUniqueOrThrow({
      include: storedInclude,
      where: { id },
    });
    return timeBlockOf(row, lifts);
  }
}
