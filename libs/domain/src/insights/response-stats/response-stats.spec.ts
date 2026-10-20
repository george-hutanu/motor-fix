import { answersSameDayOf, writeResponseStats } from './response-stats';
import type { PrismaClient } from '../../generated/prisma/client';

// @traces 1025-FR-002
// @traces 1025-FR-003
describe('whether a garage usually answers the same day', () => {
  it('holds from 70 percent answered within a day up', () => {
    expect(answersSameDayOf({ rate: 70, state: 'rate' })).toBe(true);
    expect(answersSameDayOf({ rate: 70.01, state: 'rate' })).toBe(true);
    expect(answersSameDayOf({ rate: 100, state: 'rate' })).toBe(true);
  });

  it('does not hold below the threshold, for a new garage or one with nothing counted lately', () => {
    expect(answersSameDayOf({ rate: 69, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ rate: 69.99, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ rate: 0, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ state: 'new' })).toBe(false);
    expect(answersSameDayOf({ rate: 100, state: 'new' })).toBe(false);
    expect(answersSameDayOf({ state: 'none' })).toBe(false);
  });
});

// A garage deleted between the night's count and its own write (an owner
// closing the account, a test cleaning up) leaves no row to point at: the
// night skips it instead of failing on the foreign key.
describe('the night meeting a garage deleted while it ran', () => {
  it('skips the garage and writes the others', async () => {
    const upsert = jest.fn();
    const tx = (exists: boolean) => ({
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue(exists ? [{ kept: 1 }] : []),
      garageResponseStats: { findUnique: jest.fn(), upsert },
      outboxEvent: { create: jest.fn() },
    });
    const figures = {
      answeredWithinDay30d: 0,
      lifetimeRequests: 0,
      requests30d: 0,
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([
        { garageId: 'gone', ...figures },
        { garageId: 'kept', ...figures },
      ]),
      $transaction: jest
        .fn()
        .mockImplementationOnce((run) => run(tx(false)))
        .mockImplementationOnce((run) => run(tx(true))),
    } as unknown as PrismaClient;

    const result = await writeResponseStats(db, new Date());

    expect(result).toEqual({ computed: 2, written: 1 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { garageId: 'kept' },
    });
  });
});
