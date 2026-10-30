import type { Role } from '@motor-fix/contracts/capabilities';

import type { AuditPort } from '../../audit/audit.port';
import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';

// The web address the link to the buyer points at; unset where PUBLIC_WEB_URL
// is: no link can be made, so no send.
export const TRANSFER_WEB_URL = Symbol('TRANSFER_WEB_URL');

type TransferStatus = 'sent' | 'cancelled' | 'expired' | 'accepted';

// Who moved a transfer: the seller, or the system for an expiry.
interface TransferActor {
  accountId: string | null;
  role: Role | 'system';
}

interface TransferRow {
  id: string;
  carId: string;
  sellerId: string;
  // Set on the accepted step only.
  buyerId?: string;
}

export const transferLink = (
  webUrl: string,
  language: 'ro' | 'en',
  token: string,
) => `${webUrl}/${language}/transfer/${token}`;

// A sent transfer counts only until its expiry, whether or not the daily
// sweep has marked it yet.
export const isLive = (expiresAt: Date, now: Date) =>
  expiresAt.getTime() > now.getTime();

// The event of a step, to the seller alone, and to the buyer too once taken
// over: never the phone or the token.
export const transferEvent = (
  events: EventPort,
  tx: Prisma.TransactionClient,
  transfer: TransferRow,
  status: TransferStatus,
) => {
  const { buyerId } = transfer;
  return events.record(tx, {
    audience: buyerId
      ? {
          buyerAccountId: buyerId,
          sellerAccountId: transfer.sellerId,
          type: 'car_transfer',
        }
      : { accountId: transfer.sellerId, type: 'account' },
    kind: `car_transfer.${status}`,
    payload: {
      ...(buyerId && { buyerAccountId: buyerId }),
      carId: transfer.carId,
      sellerAccountId: transfer.sellerId,
      status,
      transferId: transfer.id,
    },
    subjectId: transfer.id,
  });
};

// The audit entry and event of a sent transfer that moves on, in the
// caller's transaction. The caller has already moved the row.
export async function recordStep(
  tx: Prisma.TransactionClient,
  ports: { audit: AuditPort; events: EventPort },
  transfer: TransferRow,
  status: Exclude<TransferStatus, 'sent'>,
  actor: TransferActor,
) {
  await ports.audit.record(tx, {
    action: 'update',
    actorId: actor.accountId,
    actorRole: actor.role,
    carId: transfer.carId,
    field: 'status',
    newValue: status,
    oldValue: 'sent',
    subjectId: transfer.id,
    subjectType: 'car_transfer',
  });
  await transferEvent(ports.events, tx, transfer, status);
}

// Cancels the car's sent transfer, if it has one: a new send replaces it, a
// removal ends it. The caller holds the car's lock.
export async function cancelSentTransfer(
  tx: Prisma.TransactionClient,
  ports: { audit: AuditPort; events: EventPort },
  carId: string,
  actor: TransferActor,
) {
  const sent = await tx.carTransfer.findFirst({
    select: { carId: true, id: true, sellerId: true },
    where: { carId, status: 'sent' },
  });
  if (sent) await cancelTransfer(tx, ports, sent, actor);
}

// Cancels a sent transfer, with its entry and event.
export async function cancelTransfer(
  tx: Prisma.TransactionClient,
  ports: { audit: AuditPort; events: EventPort },
  transfer: TransferRow,
  actor: TransferActor,
) {
  await tx.carTransfer.update({
    data: { status: 'cancelled' },
    where: { id: transfer.id },
  });
  await recordStep(tx, ports, transfer, 'cancelled', actor);
}
