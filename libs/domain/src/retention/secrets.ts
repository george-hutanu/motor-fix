import { RETENTION_BATCH } from './retention.config';
import type { PrismaClient } from '../generated/prisma/client';

export const SECRET_KINDS = [
  'sign_in_code',
  'phone_change',
  'account_token',
  'refresh_token',
  'staff_invite',
] as const;

type SecretKind = (typeof SECRET_KINDS)[number];

// One bounded delete of rows whose expiry has passed, used or not; an invite
// only while still sent (an accepted or revoked one is the garage's record).
const BATCH: Record<
  SecretKind,
  (prisma: PrismaClient, now: Date) => Promise<number>
> = {
  account_token: (prisma, now) => prisma.$executeRaw`
    DELETE FROM account_token WHERE id IN (
      SELECT id FROM account_token WHERE expires_at < ${now} LIMIT ${RETENTION_BATCH})`,
  phone_change: (prisma, now) => prisma.$executeRaw`
    DELETE FROM phone_change WHERE account_id IN (
      SELECT account_id FROM phone_change WHERE expires_at < ${now} LIMIT ${RETENTION_BATCH})`,
  refresh_token: (prisma, now) => prisma.$executeRaw`
    DELETE FROM refresh_token WHERE id IN (
      SELECT id FROM refresh_token WHERE expires_at < ${now} LIMIT ${RETENTION_BATCH})`,
  sign_in_code: (prisma, now) => prisma.$executeRaw`
    DELETE FROM sign_in_code WHERE phone IN (
      SELECT phone FROM sign_in_code WHERE expires_at < ${now} LIMIT ${RETENTION_BATCH})`,
  staff_invite: (prisma, now) => prisma.$executeRaw`
    DELETE FROM staff_invite WHERE id IN (
      SELECT id FROM staff_invite
       WHERE status = 'sent' AND expires_at < ${now} LIMIT ${RETENTION_BATCH})`,
};

// Deletes every expired row of the kind, a batch at a time, and answers how many.
export async function sweepExpired(
  prisma: PrismaClient,
  kind: SecretKind,
  now: Date,
): Promise<number> {
  let total = 0;
  // Ends on a short batch: each batch takes its rows out of the next selection.
  for (;;) {
    const deleted = await BATCH[kind](prisma, now);
    total += deleted;
    if (deleted < RETENTION_BATCH) return total;
  }
}
