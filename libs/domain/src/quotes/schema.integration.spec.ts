import { randomUUID } from 'node:crypto';

import { databaseUrl, quotesWorld } from './quotes.testing';
import { serialDatabase } from '../auth/serial-db.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

let requestId: string;
let recipientId: string;
let garageId: string;

beforeAll(async () => {
  await world.reset();
  const driver = await world.account('Andrei Marin', ['driver']);
  garageId = (await world.garage('Atelier Dinamo')).id;
  requestId = (await world.request(driver)).id;
  recipientId = (await world.recipient(requestId, garageId, 'quoted')).id;
});

const valid = () => ({
  duration_minutes: 90,
  from_bani: 45_000,
  slot: new Date(Date.now() + 48 * 3_600_000).toISOString(),
  to_bani: 60_000,
});

// Written through SQL, so the columns Prisma's types would require can be
// left out and the database is what refuses.
function insertQuote(columns: Record<string, unknown>) {
  const all: Record<string, unknown> = {
    expires_at: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    garage_id: garageId,
    id: randomUUID(),
    recipient_id: recipientId,
    request_id: requestId,
    ...columns,
  };
  const names = Object.keys(all);
  const casts: Record<string, string> = {
    expires_at: '::timestamptz',
    garage_id: '::uuid',
    id: '::uuid',
    recipient_id: '::uuid',
    request_id: '::uuid',
    slot: '::timestamptz',
  };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO quote (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names
        .map((n, i) => `$${i + 1}${casts[n] ?? ''}`)
        .join(', ')})`,
      ...names.map((n) => all[n]),
    );
    throw new Error('rolled back');
  });
}

// @traces 220-FR-005
describe('the quote table', () => {
  it('takes a quote with its range, duration and slot', async () => {
    await expect(insertQuote(valid())).rejects.toThrow('rolled back');
  });

  it.each(['from_bani', 'to_bani', 'slot', 'duration_minutes'])(
    'refuses a quote without %s',
    async (column) => {
      const { [column as keyof ReturnType<typeof valid>]: _, ...rest } =
        valid();

      await expect(insertQuote(rest)).rejects.toThrow(/null value|not-null/i);
    },
  );

  it.each([
    ['a lower bound of zero', { from_bani: 0 }, 'quote_range_check'],
    ['a negative lower bound', { from_bani: -100 }, 'quote_range_check'],
    [
      'an upper bound under the lower',
      { from_bani: 50_000, to_bani: 49_999 },
      'quote_range_check',
    ],
    ['a duration of zero', { duration_minutes: 0 }, 'quote_duration_check'],
  ])('refuses %s', async (_case, change, constraint) => {
    await expect(insertQuote({ ...valid(), ...change })).rejects.toThrow(
      constraint,
    );
  });

  it('takes a fixed price, where both bounds are equal', async () => {
    await expect(
      insertQuote({ ...valid(), from_bani: 50_000, to_bani: 50_000 }),
    ).rejects.toThrow('rolled back');
  });
});
