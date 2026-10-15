import { randomUUID } from 'node:crypto';

import { databaseUrl, quotesWorld } from './quotes.testing';
import { CANCEL_REASONS } from './quotes-config';
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
    idempotency_key: randomUUID(),
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

function updateRequest(set: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE quote_request SET ${set} WHERE id = $1::uuid`,
      requestId,
    );
    throw new Error('rolled back');
  });
}

// @traces 220-FR-002
describe('the request close columns', () => {
  it('takes a closed request with its reason and time', async () => {
    await expect(
      updateRequest(
        `status = 'closed', closed_reason = 'cancelled', closed_at = now()`,
      ),
    ).rejects.toThrow('rolled back');
  });

  it.each([
    [
      'a closed request without a reason',
      `status = 'closed', closed_at = now()`,
    ],
    [
      'a closed request without a time',
      `status = 'closed', closed_reason = 'expired'`,
    ],
    [
      'a reason on a request that is not closed',
      `closed_reason = 'no_show', closed_at = now()`,
    ],
  ])('refuses %s', async (_case, set) => {
    await expect(updateRequest(set)).rejects.toThrow(
      'quote_request_closed_check',
    );
  });

  it('refuses a reason outside the list', async () => {
    await expect(
      updateRequest(
        `status = 'closed', closed_reason = 'lost', closed_at = now()`,
      ),
    ).rejects.toThrow(/invalid input value/i);
  });
});

// @traces 220-FR-010
describe('the per-side cancellation reasons in the database', () => {
  it.each(Object.keys(CANCEL_REASONS) as (keyof typeof CANCEL_REASONS)[])(
    'match the config for the %s side',
    async (side) => {
      const [{ def }] = await prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'booking_cancel_reason_side_check'`;
      const branch = def.match(
        new RegExp(`cancelled_by_side = '${side}'[^\\[]*\\[([^\\]]*)\\]`),
      );

      expect(
        [...(branch?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
      ).toEqual(CANCEL_REASONS[side]);
    },
  );
});

// @traces 222-FR-003
describe('the booking idempotency key', () => {
  let quoteIds: string[];
  let driverId: string;

  beforeAll(async () => {
    const request = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    driverId = request.driverId;
    const garages = await Promise.all(
      ['Service Militari', 'Auto Pipera', 'Garaj Titan'].map((name) =>
        world.garage(name),
      ),
    );
    quoteIds = [];
    for (const garage of garages) {
      quoteIds.push((await world.quote(requestId, garage.id)).id);
    }
  });

  afterEach(() =>
    prisma.booking.deleteMany({ where: { quoteId: { in: quoteIds } } }),
  );

  const bookingWith = async (quoteId: string, key: string | null) => {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
    });
    return prisma.booking.create({
      data: {
        confirmBy: quote.slot,
        driverId,
        durationMinutes: quote.durationMinutes,
        garageId: quote.garageId,
        idempotencyKey: key,
        quoteId,
        requestId,
        startsAt: quote.slot,
      },
    });
  };

  it('is optional, so bookings other paths write need none', async () => {
    const booking = await bookingWith(quoteIds[0], null);

    expect(booking.idempotencyKey).toBeNull();
  });

  it('lets two bookings without a key stand side by side', async () => {
    await bookingWith(quoteIds[0], null);

    await expect(bookingWith(quoteIds[1], null)).resolves.toBeDefined();
  });

  it('refuses a second booking with the same key for the same driver', async () => {
    const key = randomUUID();
    await bookingWith(quoteIds[0], key);

    await expect(bookingWith(quoteIds[1], key)).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it.each([
    ['empty', ''],
    ['201 characters', 'k'.repeat(201)],
  ])('refuses a key that is %s', async (_, key) => {
    await expect(bookingWith(quoteIds[2], key)).rejects.toThrow(
      /booking_idempotency_key_length/,
    );
  });

  it('takes a key of 200 characters', async () => {
    const booking = await bookingWith(quoteIds[2], 'k'.repeat(200));

    expect(booking.idempotencyKey).toHaveLength(200);
  });
});
