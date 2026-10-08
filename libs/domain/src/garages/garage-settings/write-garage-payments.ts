import { hoursComplete, isHoursSection } from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import { refusal } from '../../auth/sign-up.service';
import type { Prisma } from '../../generated/prisma/client';

// Writes a garage's payment methods and courtesy car price from the listing's
// step 5 section, inside the caller's transaction. A courtesy car the section
// does not list is neither paid nor priced. The caller records the event;
// this writes the row only.
export async function writeGaragePayments(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: Record<string, unknown>,
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
  await tx.garage.update({
    data: {
      courtesyCarPaid: paid,
      courtesyCarPricePerDayBani: paid
        ? (section.courtesyCar?.pricePerDayBani ?? null)
        : null,
      paymentCard: payments.includes('card'),
      paymentCash: payments.includes('cash'),
      paymentTransfer: payments.includes('transfer'),
    },
    where: { id: garageId },
  });
}
