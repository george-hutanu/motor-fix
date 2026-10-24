// @traces 392-FR-003

import { smsMonth, smsUsed } from './sms-counter';
import type { PrismaClient } from '../generated/prisma/client';

describe('the month an SMS counts in', () => {
  it('is the calendar month in Bucharest, not in UTC', () => {
    // 31 October 23:59 and 1 November 00:00 local time (UTC+2 after the clock change).
    expect(smsMonth(new Date('2026-10-31T21:59:00Z'))).toBe('2026-10');
    expect(smsMonth(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11');
  });

  it('turns over at midnight in summer time too', () => {
    // 30 June 23:59 and 1 July 00:00 local time (UTC+3).
    expect(smsMonth(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06');
    expect(smsMonth(new Date('2026-06-30T21:00:00Z'))).toBe('2026-07');
  });

  it('turns over the year', () => {
    expect(smsMonth(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01');
  });
});

// @traces 142-FR-004
describe('the SMS a driver has used this month', () => {
  const counted = (rows: Record<string, number>) => {
    const findUnique = jest.fn(
      async ({
        where,
      }: {
        where: { accountId_month: { accountId: string; month: string } };
      }) => {
        const sentCount = rows[where.accountId_month.month];
        return sentCount === undefined ? null : { sentCount };
      },
    );
    return {
      findUnique,
      prisma: { smsCounter: { findUnique } } as unknown as PrismaClient,
    };
  };

  it('is 0 with nothing sent', async () => {
    const { prisma } = counted({});
    expect(await smsUsed(prisma, 'ana', new Date('2026-10-20T10:00:00Z'))).toBe(
      0,
    );
  });

  it("is the month's count in Bucharest", async () => {
    const { findUnique, prisma } = counted({ '2026-10': 5 });
    expect(await smsUsed(prisma, 'ana', new Date('2026-10-31T21:59:00Z'))).toBe(
      5,
    );
    expect(findUnique).toHaveBeenCalledWith({
      select: { sentCount: true },
      where: { accountId_month: { accountId: 'ana', month: '2026-10' } },
    });
  });

  it('is 0 again at 00:00 on the 1st in Bucharest', async () => {
    const { prisma } = counted({ '2026-10': 5 });
    expect(await smsUsed(prisma, 'ana', new Date('2026-10-31T22:00:00Z'))).toBe(
      0,
    );
  });
});
