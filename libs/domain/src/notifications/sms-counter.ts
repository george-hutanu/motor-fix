import type { PrismaClient } from '../generated/prisma/client';

// The owner's cap on what MotorFix pays for: 5 SMS per driver per month.
const SMS_PER_MONTH = 5;

const month = new Intl.DateTimeFormat('en-CA', {
  month: '2-digit',
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
});

// "2026-11": the calendar month in Bucharest an SMS sent at `at` counts in.
export const smsMonth = (at: Date) => month.format(at).slice(0, 7);

// One statement, so two sends at once cannot both take the last SMS.
export async function takeSms(
  prisma: PrismaClient,
  accountId: string,
  inMonth: string,
): Promise<boolean> {
  const taken = await prisma.$queryRaw<unknown[]>`
    INSERT INTO sms_counter (account_id, month, sent_count)
    VALUES (${accountId}::uuid, ${inMonth}, 1)
    ON CONFLICT (account_id, month) DO UPDATE
      SET sent_count = sms_counter.sent_count + 1
      WHERE sms_counter.sent_count < ${SMS_PER_MONTH}
    RETURNING sent_count`;
  return taken.length === 1;
}

// A failed SMS does not count.
export async function giveSmsBack(
  prisma: PrismaClient,
  accountId: string,
  inMonth: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE sms_counter SET sent_count = sent_count - 1
    WHERE account_id = ${accountId}::uuid AND month = ${inMonth} AND sent_count > 0`;
}
