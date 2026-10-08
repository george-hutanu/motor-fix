import type { GarageSettingsDto, UpdateGarageDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { assertOwner } from '../garage-brands/garage-brands.service';

// The columns as the history names them.
type Stored = {
  payment_cash: boolean;
  payment_card: boolean;
  payment_transfer: boolean;
  courtesy_car_paid: boolean;
  courtesy_car_price_per_day_bani: number | null;
};

const PAYMENT_FIELDS = [
  'payment_cash',
  'payment_card',
  'payment_transfer',
] as const;
const COURTESY_FIELDS = [
  'courtesy_car_paid',
  'courtesy_car_price_per_day_bani',
] as const;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

// The row locked, so two changes to one garage run one after the other.
async function lockGarage(tx: Prisma.TransactionClient, garageId: string) {
  const [row] = await tx.$queryRaw<(Stored & { listed: boolean })[]>`
    SELECT payment_cash, payment_card, payment_transfer, courtesy_car_paid,
      courtesy_car_price_per_day_bani,
      EXISTS (SELECT 1 FROM garage_facility f
        WHERE f.garage_id = g.id AND f.facility = 'courtesy_car') AS listed
    FROM garage g WHERE id = ${garageId}::uuid FOR UPDATE`;
  if (!row) throw notFound();
  return row;
}

function applied(before: Stored, dto: UpdateGarageDto): Stored {
  const { courtesyCar, paymentMethods } = dto;
  return {
    ...before,
    ...(paymentMethods && {
      payment_card: paymentMethods.card,
      payment_cash: paymentMethods.cash,
      payment_transfer: paymentMethods.transfer,
    }),
    ...(courtesyCar && {
      courtesy_car_paid: courtesyCar.paid,
      courtesy_car_price_per_day_bani: courtesyCar.pricePerDayBani ?? null,
    }),
  };
}

function answer(row: Stored, listed: boolean): GarageSettingsDto {
  const price = row.courtesy_car_price_per_day_bani;
  return {
    paymentMethods: {
      card: row.payment_card,
      cash: row.payment_cash,
      transfer: row.payment_transfer,
    },
    ...(listed && {
      courtesyCar: {
        paid: row.courtesy_car_paid,
        ...(price !== null && { pricePerDayBani: price }),
      },
    }),
  };
}

@Injectable()
export class GarageSettingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // The owner's payment methods and courtesy car price; no re-approval.
  async update(
    actor: Actor,
    garageId: string,
    dto: UpdateGarageDto,
  ): Promise<GarageSettingsDto> {
    assertOwner(actor, garageId);
    return this.prisma.$transaction(async (tx) => {
      const { listed, ...before } = await lockGarage(tx, garageId);
      if (dto.courtesyCar && !listed) {
        throw refusal(
          HttpStatus.BAD_REQUEST,
          'validation_failed',
          'The garage does not list a courtesy car',
          [{ code: 'no_courtesy_car', field: 'courtesyCar' }],
        );
      }
      const after = applied(before, dto);
      await this.persist(tx, actor, garageId, before, after);
      return answer(after, listed);
    });
  }

  private async persist(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    before: Stored,
    after: Stored,
  ) {
    const moved = (fields: readonly (keyof Stored)[]) =>
      fields.some((field) => before[field] !== after[field]);
    const payments = moved(PAYMENT_FIELDS);
    const courtesy = moved(COURTESY_FIELDS);
    if (!payments && !courtesy) return;
    await tx.garage.update({
      data: {
        courtesyCarPaid: after.courtesy_car_paid,
        courtesyCarPricePerDayBani: after.courtesy_car_price_per_day_bani,
        paymentCard: after.payment_card,
        paymentCash: after.payment_cash,
        paymentTransfer: after.payment_transfer,
      },
      where: { id: garageId },
    });
    await this.audit.recordChanges(
      tx,
      {
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        subjectId: garageId,
        subjectType: 'garage',
      },
      before,
      after,
    );
    await this.events.record(tx, {
      // A payment method can move the garage in search results.
      audience: { garageId, results: payments, type: 'public_garage' },
      kind: 'garage.updated',
      payload: {
        fields: [
          ...(payments ? ['payment_methods'] : []),
          ...(courtesy ? ['courtesy_car'] : []),
        ],
        garageId,
      },
      subjectId: garageId,
    });
  }
}
