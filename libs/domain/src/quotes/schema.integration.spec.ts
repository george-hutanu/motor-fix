import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// @traces 389-FR-006
describe('the garage lift count', () => {
  const MIGRATIONS = join(__dirname, '../../prisma/migrations');

  // The part of the migration after its backfill marker, statement by
  // statement.
  const backfill = () => {
    const folder = readdirSync(MIGRATIONS).find((name) =>
      name.endsWith('_booking_confirm'),
    );
    return readFileSync(
      join(MIGRATIONS, String(folder), 'migration.sql'),
      'utf8',
    )
      .split('-- backfill')[1]
      .split(/;\s*$/m)
      .map((sql) => sql.replace(/--.*$/gm, '').trim())
      .filter((sql) => sql !== '');
  };

  const surveyed = async (lifts: string | null) => {
    const garage = await world.garage(`Garaj ${randomUUID()}`);
    if (lifts !== null) {
      await prisma.garageSurvey.create({
        data: {
          foundVia: 'google',
          garageId: garage.id,
          liftsCount: lifts,
          mechanicsCount: '1-2',
          wantsDaySheets: false,
          wantsLiveMedia: false,
        },
      });
    }
    return garage.id;
  };

  it('is 0 for a new garage', async () => {
    const garage = await world.garage('Garaj Nordic');

    expect(garage.liftCount).toBe(0);
  });

  it('refuses a negative count', async () => {
    const garage = await world.garage('Garaj Nordic');

    await expect(
      prisma.garage.update({
        data: { liftCount: -1 },
        where: { id: garage.id },
      }),
    ).rejects.toThrow(/lift_count/);
  });

  it('is filled once from the sign-up survey, 0 without one', async () => {
    const ids = {
      fourPlus: await surveyed('4+'),
      none: await surveyed(null),
      one: await surveyed('1'),
      twoThree: await surveyed('2-3'),
      zero: await surveyed('0'),
    };
    await prisma.garage.updateMany({
      data: { liftCount: 0 },
      where: { id: { in: Object.values(ids) } },
    });

    for (const sql of backfill()) await prisma.$executeRawUnsafe(sql);

    const counts = Object.fromEntries(
      await Promise.all(
        Object.entries(ids).map(async ([key, id]) => [
          key,
          (await prisma.garage.findUniqueOrThrow({ where: { id } })).liftCount,
        ]),
      ),
    );
    expect(counts).toEqual({
      fourPlus: 4,
      none: 0,
      one: 1,
      twoThree: 2,
      zero: 0,
    });
  });
});

// @traces 150-FR-001
// @traces 150-FR-013
describe('the segments of confirmed bookings', () => {
  // 09:00 in Bucharest; every booking the world makes lasts 90 minutes.
  const NINE = Date.parse('2026-11-12T07:00:00Z');
  const at = (minutes: number) => new Date(NINE + minutes * 60_000);
  const MIGRATIONS = join(__dirname, '../../prisma/migrations');

  // The migration's backfill, between its two markers, statement by
  // statement.
  const backfill = () => {
    const folder = readdirSync(MIGRATIONS).find((name) =>
      name.endsWith('_booking_segments'),
    );
    return readFileSync(
      join(MIGRATIONS, String(folder), 'migration.sql'),
      'utf8',
    )
      .split('-- backfill')[1]
      .split('-- end backfill')[0]
      .split(/;\s*$/m)
      .map((sql) => sql.replace(/--.*$/gm, '').trim())
      .filter((sql) => sql !== '');
  };

  let garageId: string;
  let mechanicId: string;
  // A booking awaiting the garage, which holds no segment of its own.
  let bookingId: string;

  beforeEach(async () => {
    garageId = (await world.garage('Garaj Nordic')).id;
    mechanicId = (
      await prisma.mechanic.create({
        data: { garageId, name: 'Mihai Dumitru' },
      })
    ).id;
    bookingId = (
      await world.booked(garageId, at(0).toISOString(), 'awaiting_confirmation')
    ).id;
  });

  const segment = (
    from: number,
    to: number,
    place: { garage?: string; lift?: number; mechanic?: string | null } = {},
  ) =>
    prisma.bookingSegment.create({
      data: {
        bookingId,
        endsAt: at(to),
        garageId: place.garage ?? garageId,
        lift: place.lift ?? null,
        mechanicId: place.mechanic === undefined ? mechanicId : place.mechanic,
        startsAt: at(from),
      },
    });

  it('backfills one segment for each confirmed booking and none for the others', async () => {
    const confirmed = await world.booked(
      garageId,
      at(120).toISOString(),
      'confirmed',
      { lift: 2, mechanicId },
    );
    const others = await Promise.all(
      (['cancelled', 'lapsed', 'completed', 'no_show'] as const).map((status) =>
        world.booked(garageId, at(0).toISOString(), status),
      ),
    );
    await prisma.bookingSegment.deleteMany({});

    for (const sql of backfill()) await prisma.$executeRawUnsafe(sql);
    for (const sql of backfill()) await prisma.$executeRawUnsafe(sql);

    expect(
      await prisma.bookingSegment.findMany({
        where: { bookingId: confirmed.id },
      }),
    ).toEqual([
      expect.objectContaining({
        endsAt: at(210),
        garageId,
        lift: 2,
        mechanicId,
        startsAt: at(120),
      }),
    ]);
    expect(
      await prisma.bookingSegment.count({
        where: { bookingId: { in: [bookingId, ...others.map((b) => b.id)] } },
      }),
    ).toBe(0);
  });

  it('leaves the overlap rules of the booking table to the segments', async () => {
    const left = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('booking_mechanic_span_excl', 'booking_lift_span_excl')`;

    expect(left).toEqual([]);
  });

  it('refuses a mechanic two segments that overlap', async () => {
    await segment(0, 90);

    await expect(segment(30, 120)).rejects.toThrow(
      /booking_segment_mechanic_excl/,
    );
  });

  it('refuses one lift of a garage two segments that overlap', async () => {
    await segment(0, 90, { lift: 1, mechanic: null });

    await expect(segment(89, 120, { lift: 1, mechanic: null })).rejects.toThrow(
      /booking_segment_lift_excl/,
    );
  });

  it('lets a segment start where the other ends', async () => {
    await segment(0, 90, { lift: 1 });

    await expect(segment(90, 180, { lift: 1 })).resolves.toMatchObject({
      lift: 1,
    });
  });

  it('lets another lift, another garage’s lift and no mechanic overlap', async () => {
    const other = (await world.garage('Service Militari')).id;
    await segment(0, 90, { lift: 1 });

    await expect(
      Promise.all([
        segment(0, 90, { lift: 2, mechanic: null }),
        segment(0, 90, { garage: other, lift: 1, mechanic: null }),
        segment(0, 90, { mechanic: null }),
        segment(0, 90, { mechanic: null }),
      ]),
    ).resolves.toHaveLength(4);
  });

  it('refuses a segment that does not end after it starts', async () => {
    await expect(segment(90, 90)).rejects.toThrow(
      /booking_segment_order_check/,
    );
  });

  it('goes with its booking', async () => {
    await segment(0, 90);

    await prisma.booking.delete({ where: { id: bookingId } });

    expect(await prisma.bookingSegment.count({ where: { bookingId } })).toBe(0);
  });
});
