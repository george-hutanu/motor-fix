import type { SavedGarageDto, SavedGarageIdsDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import {
  type DomainEvent,
  EVENT_PORT,
  type EventPort,
} from '../../events/event.port';
import {
  Prisma,
  type PrismaClient,
  type SavedGarage,
} from '../../generated/prisma/client';

// Whether the save made the row, so the controller answers 201 or 200.
type Saved = { created: boolean; row: SavedGarageDto };

const answer = (row: SavedGarage): SavedGarageDto => ({
  garageId: row.garageId,
  savedAt: row.savedAt.toISOString(),
});

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

type Change = 'added' | 'removed';

const entry = (
  actor: Actor,
  change: Change,
  row: SavedGarageDto,
): AuditEntry => ({
  action: change === 'added' ? 'create' : 'delete',
  actorId: actor.accountId,
  actorRole: actor.role,
  [change === 'added' ? 'newValue' : 'oldValue']: row,
  subjectId: row.garageId,
  subjectType: 'saved_garage',
});

// To the driver's own channel only: no garage learns who saved it.
const event = (
  actor: Actor,
  change: Change,
  row: SavedGarageDto,
): DomainEvent => ({
  audience: { accountId: actor.accountId, type: 'account' },
  kind: `saved_garage.${change}`,
  payload: { accountId: actor.accountId, ...row },
  subjectId: row.garageId,
});

// The role in use first, so a garage-side account learns to switch roles
// rather than meeting the capability policy's 404.
function driverOnly(actor: Actor) {
  if (actor.role !== 'driver') {
    throw refusal(
      HttpStatus.FORBIDDEN,
      'driver_role_required',
      'Switch to your driver role to save garages',
    );
  }
  requireCapability(actor, 'driver.saved_garages');
}

// A driver's saved garages. The audit entry carries no garage id, so the
// garage's own history never shows who saved it.
@Injectable()
export class SavedGaragesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async save(
    actor: Actor,
    garageId: string,
    savedAt?: string,
    again = true,
  ): Promise<Saved> {
    driverOnly(actor);
    const at = savedAt ? new Date(savedAt) : new Date();
    if (at.getTime() > Date.now()) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'saved_at_in_future',
        'The time a garage was saved cannot be in the future',
      );
    }
    const key = { accountId: actor.accountId, garageId };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const kept = await tx.savedGarage.findUnique({
          where: { accountId_garageId: key },
        });
        if (kept) return { created: false, row: answer(kept) };
        const garage = await tx.garage.findFirst({
          select: { id: true },
          where: { id: garageId, status: 'approved' },
        });
        if (!garage) {
          throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
        }
        const row = answer(
          await tx.savedGarage.create({ data: { ...key, savedAt: at } }),
        );
        await this.audit.record(tx, entry(actor, 'added', row));
        await this.events.record(tx, event(actor, 'added', row));
        return { created: true, row };
      });
    } catch (error) {
      // Two tabs saving at once: the first made the row, this one found it.
      if (!isUniqueViolation(error)) throw error;
      const kept = await this.prisma.savedGarage.findUnique({
        where: { accountId_garageId: key },
      });
      if (kept) return { created: false, row: answer(kept) };
      // A removal landed in between: this save goes again, once.
      if (again) return this.save(actor, garageId, savedAt, false);
      throw error;
    }
  }

  // The removed row, whose time an undo sends back; null when none was saved.
  async remove(actor: Actor, garageId: string): Promise<SavedGarageDto | null> {
    driverOnly(actor);
    return this.prisma.$transaction(async (tx) => {
      const [gone] = await tx.$queryRaw<SavedGarage[]>`
        DELETE FROM saved_garage
        WHERE account_id = ${actor.accountId}::uuid AND garage_id = ${garageId}::uuid
        RETURNING account_id AS "accountId", garage_id AS "garageId", saved_at AS "savedAt"`;
      if (!gone) return null;
      const row = answer(gone);
      await this.audit.record(tx, entry(actor, 'removed', row));
      await this.events.record(tx, event(actor, 'removed', row));
      return row;
    });
  }

  async ids(actor: Actor): Promise<SavedGarageIdsDto> {
    driverOnly(actor);
    const rows = await this.prisma.savedGarage.findMany({
      select: { garageId: true },
      where: { accountId: actor.accountId },
    });
    return { ids: rows.map((row) => row.garageId) };
  }
}
