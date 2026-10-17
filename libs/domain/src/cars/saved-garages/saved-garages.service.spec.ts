import {
  cursorOf,
  readCursor,
  SavedGaragesService,
} from './saved-garages.service';
import type { AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import type { EventPort } from '../../events/event.port';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

const driver: Actor = {
  accountId: '00000000-0000-4000-8000-000000000001',
  garageId: null,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
};
const garageId = '00000000-0000-4000-8000-000000000002';
const savedAt = new Date('2026-10-01T08:00:00.000Z');

const unique = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    clientVersion: 'test',
    code: 'P2002',
  });

// The database is faked: a real race between two saves and a removal cannot
// be timed. The integration spec covers the plain race against PostgreSQL.
function service(transactions: Array<() => Promise<unknown>>, kept: unknown) {
  const transaction = jest.fn(() => {
    const next = transactions.shift();
    if (!next) throw new Error('no more transactions');
    return next();
  });
  const prisma = {
    $transaction: transaction,
    savedGarage: { findUnique: jest.fn(async () => kept) },
  } as unknown as PrismaClient;
  const none = { record: jest.fn() };
  return {
    saved: new SavedGaragesService(
      prisma,
      none as unknown as AuditPort,
      none as unknown as EventPort,
    ),
    transaction,
  };
}

// @traces 290-FR-002
describe('a save that loses the race to another save', () => {
  it('answers the row the other save made', async () => {
    const { saved } = service([() => Promise.reject(unique())], {
      accountId: driver.accountId,
      garageId,
      savedAt,
    });

    await expect(saved.save(driver, garageId)).resolves.toEqual({
      created: false,
      row: { garageId, savedAt: savedAt.toISOString() },
    });
  });

  it('saves again, once, when a removal took that row before the re-read', async () => {
    const made = { created: true, row: { garageId, savedAt: 'now' } };
    const { saved, transaction } = service(
      [() => Promise.reject(unique()), () => Promise.resolve(made)],
      null,
    );

    await expect(saved.save(driver, garageId)).resolves.toBe(made);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second try loses the same way', async () => {
    const { saved, transaction } = service(
      [() => Promise.reject(unique()), () => Promise.reject(unique())],
      null,
    );

    await expect(saved.save(driver, garageId)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});

// @traces 291-FR-001
describe('the saved list cursor', () => {
  it('reads back the time and id it was made from', () => {
    const cursor = cursorOf({ garageId, savedAt });

    expect(cursor).toMatch(/^[\w-]+$/);
    expect(readCursor(cursor)).toEqual({ at: savedAt, id: garageId });
  });

  it.each([
    ['text that is not base64 JSON', '%%%'],
    ['JSON that is not an object', Buffer.from('3').toString('base64url')],
    [
      'a missing id',
      Buffer.from('{"at":"2026-10-01T08:00:00.000Z"}').toString('base64url'),
    ],
    [
      'a date that is not one',
      Buffer.from(`{"at":"x","id":"${garageId}"}`).toString('base64url'),
    ],
    [
      'an id that is not a uuid',
      Buffer.from('{"at":"2026-10-01T08:00:00.000Z","id":"1"}').toString(
        'base64url',
      ),
    ],
  ])('refuses %s with 400 invalid_cursor', (_, text) => {
    expect(() => readCursor(text)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'invalid_cursor' }),
      }),
    );
  });
});
