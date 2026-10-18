import { hoursComplete, isHoursSection } from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import type { AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/sign-up.service';
import type { Prisma } from '../../generated/prisma/client';

// Writes a garage's payment methods and courtesy car price from the listing's
// step 5 section, inside the caller's transaction. A courtesy car the section
// does not list is neither paid nor priced. Each changed field goes to the
// history as the garage's own edit; the caller records the event.
export async function writeGaragePayments(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: Record<string, unknown>,
  { actorId, audit }: { actorId: string; audit: AuditPort },
): Promise<void> {
  if (!isHoursSection(section) || !hoursComplete(section)) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The payment methods or the courtesy car price break a rule',
    );
  }
  const payments = section.payments ?? [];
  const listed = (section.facilities ?? []).includes('courtesy_car');
  const paid = listed && section.courtesyCar?.paid === true;
  const columns = {
    courtesyCarPaid: true,
    courtesyCarPricePerDayBani: true,
    paymentCard: true,
    paymentCash: true,
    paymentTransfer: true,
  } as const;
  const before = await tx.garage.findUniqueOrThrow({
    select: columns,
    where: { id: garageId },
  });
  const after = await tx.garage.update({
    data: {
      courtesyCarPaid: paid,
      courtesyCarPricePerDayBani: paid
        ? (section.courtesyCar?.pricePerDayBani ?? null)
        : null,
      paymentCard: payments.includes('card'),
      paymentCash: payments.includes('cash'),
      paymentTransfer: payments.includes('transfer'),
    },
    select: columns,
    where: { id: garageId },
  });
  await audit.recordChanges(
    tx,
    {
      actorId,
      actorRole: 'garage',
      garageId,
      subjectId: garageId,
      subjectType: 'garage',
    },
    historyNames(before),
    historyNames(after),
  );
}

// The columns as the history names them, as the settings screen records them.
function historyNames(row: {
  courtesyCarPaid: boolean;
  courtesyCarPricePerDayBani: number | null;
  paymentCard: boolean;
  paymentCash: boolean;
  paymentTransfer: boolean;
}) {
  return {
    courtesy_car_paid: row.courtesyCarPaid,
    courtesy_car_price_per_day_bani: row.courtesyCarPricePerDayBani,
    payment_card: row.paymentCard,
    payment_cash: row.paymentCash,
    payment_transfer: row.paymentTransfer,
  };
}
