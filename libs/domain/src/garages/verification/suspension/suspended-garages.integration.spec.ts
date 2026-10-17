import { randomUUID } from 'node:crypto';

import type { SuspensionCause } from '@motor-fix/contracts';

import { countGarages, suspendedGarages } from './suspended-garages';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { BookingCancelReason } from '../../../generated/prisma/enums';
import { cityOf } from '../../../places/city';
import { databaseUrl, quotesWorld } from '../../../quotes/quotes.testing';

// @traces 066-FR-001 066-FR-002 066-FR-003 066-FR-004 066-FR-005 066-FR-011

// The key the app derives from a city's name (places/city.ts).
const cityColumns = (name: string) => {
  const city = cityOf(name);
  if (!city) throw new Error(`no city key for "${name}"`);
  return { cityKey: city.key, cityName: city.name };
};

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

afterAll(() => prisma.$disconnect());
beforeEach(() => world.reset());

const garage = (
  name: string,
  status: 'draft' | 'approved' | 'suspended',
  place: { cityName?: string; radiusKm?: number } = {},
) =>
  prisma.garage.create({
    data: {
      name,
      slug: `g-${randomUUID()}`,
      status,
      // A city carries its name and its key together (garage_city_both).
      ...(place.cityName && cityColumns(place.cityName)),
      ...(place.radiusKm !== undefined && {
        businessKind: 'mobile',
        serviceRadiusKm: place.radiusKm,
      }),
    },
  });

const suspended = async (
  name: string,
  fromTime: Date,
  cause: SuspensionCause = 'admin',
  reason = 'Decizie de verificare',
  place: { cityName?: string; radiusKm?: number } = {},
) => {
  const g = await garage(name, 'suspended', place);
  await prisma.garageSuspension.create({
    data: { cause, fromTime, garageId: g.id, reason },
  });
  return g;
};

const page = (offset = 0, limit = 20) =>
  suspendedGarages(prisma, { limit, offset });

describe('the counts under the Service-uri title', () => {
  it('counts listed and suspended garages, and a draft nowhere', async () => {
    await garage('Unu', 'approved');
    await garage('Doi', 'approved');
    await garage('Ciornă', 'draft');
    await suspended('Trei', new Date('2026-09-12T08:00:00Z'));

    expect(await countGarages(prisma)).toEqual({ listed: 2, suspended: 1 });
  });

  it('writes nothing to the history when read', async () => {
    await suspended('Trei', new Date('2026-09-12T08:00:00Z'));
    const before = await prisma.activityLog.count();

    await countGarages(prisma);
    await page();

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe('the list of suspended garages', () => {
  it('lists only suspended garages, the most recent suspension first, with the total', async () => {
    await garage('Listat', 'approved');
    await suspended('Vechi', new Date('2026-08-01T08:00:00Z'));
    await suspended('Nou', new Date('2026-09-12T08:00:00Z'));

    const answer = await page();

    expect(answer.total).toBe(2);
    expect(answer.items.map((row) => row.name)).toEqual(['Nou', 'Vechi']);
  });

  it('orders suspensions that started together by the garage id, across pages', async () => {
    const at = new Date('2026-09-12T08:00:00Z');
    const ids = [];
    for (const name of ['A', 'B', 'C'])
      ids.push((await suspended(name, at)).id);

    const first = await page(0, 2);
    const second = await page(2, 2);

    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
      [...ids].sort(),
    );
    expect(first.total).toBe(3);
  });

  it("carries the open suspension's cause, reason, start and the garage's place", async () => {
    const g = await suspended(
      'Auto Expres Pantelimon',
      new Date('2026-09-12T08:00:00Z'),
      'recheck_failed',
      'Autorizație RAR expirată pe 12 sept. 2026',
      { cityName: 'Pantelimon' },
    );

    const [row] = (await page()).items;

    expect(row).toEqual({
      area: { kind: 'town', name: 'Pantelimon' },
      cancelledBookings: 0,
      cause: 'recheck_failed',
      fromTime: '2026-09-12T08:00:00.000Z',
      id: g.id,
      name: 'Auto Expres Pantelimon',
      rarVerdict: 'expired',
      reason: 'Autorizație RAR expirată pe 12 sept. 2026',
    });
  });

  it('gives a mobile mechanic its radius and a garage with no town no area', async () => {
    await suspended('Mobil', new Date('2026-09-12T08:00:00Z'), 'admin', 'x', {
      radiusKm: 25,
    });
    await suspended('Fără oraș', new Date('2026-09-11T08:00:00Z'));

    const [mobile, none] = (await page()).items;

    expect(mobile.area).toEqual({ kind: 'mobile', radiusKm: 25 });
    expect(none.area).toBeUndefined();
  });

  it('shows the newest open suspension and leaves a lifted one out', async () => {
    const g = await suspended('Reluat', new Date('2026-09-12T08:00:00Z'));
    await prisma.garageSuspension.create({
      data: {
        cause: 'documents_overdue',
        fromTime: new Date('2026-05-01T08:00:00Z'),
        garageId: g.id,
        reason: 'Vechi',
        untilTime: new Date('2026-06-01T08:00:00Z'),
      },
    });

    const answer = await page();

    expect(answer.items).toHaveLength(1);
    expect(answer.items[0]).toMatchObject({ cause: 'admin' });
  });

  it('lists a suspended garage with no open suspension last, with none of its fields', async () => {
    await suspended('Cu suspendare', new Date('2026-09-12T08:00:00Z'));
    const bare = await garage('Fără suspendare', 'suspended');

    const answer = await page();

    expect(answer.items.map((row) => row.name)).toEqual([
      'Cu suspendare',
      'Fără suspendare',
    ]);
    expect(answer.items[1]).toEqual({ id: bare.id, name: 'Fără suspendare' });
  });

  it("links the garage's newest verification file", async () => {
    const g = await suspended('Cu dosar', new Date('2026-09-12T08:00:00Z'));
    await prisma.verificationFile.create({
      data: {
        createdAt: new Date('2026-01-01T08:00:00Z'),
        garageId: g.id,
        status: 'rejected',
      },
    });
    const newest = await prisma.verificationFile.create({
      data: {
        createdAt: new Date('2026-02-01T08:00:00Z'),
        garageId: g.id,
        status: 'approved',
      },
    });

    expect((await page()).items[0].fileId).toBe(newest.id);
  });

  it('counts only the bookings cancelled by the suspension since it began', async () => {
    const from = new Date('2026-09-12T08:00:00Z');
    const g = await suspended('Cu programări', from);
    const before = new Date('2026-09-01T08:00:00Z');
    const after = new Date('2026-09-12T09:00:00Z');
    await booking(g.id, 'garage_suspended', after);
    await booking(g.id, 'garage_suspended', after);
    await booking(g.id, 'garage_suspended', before);
    await booking(g.id, 'plans_changed', after);

    expect((await page()).items[0].cancelledBookings).toBe(2);
  });

  it.each([
    ['recheck_failed', 'Autorizație RAR suspendată', 'suspended'],
    ['recheck_failed', 'Autorizație RAR retrasă', 'withdrawn'],
    ['recheck_failed', 'Registrul nu a răspuns', undefined],
    ['documents_overdue', 'Autorizație RAR expirată', undefined],
    ['report_confirmed', 'Autorizație RAR expirată', undefined],
    ['admin', 'Autorizație RAR expirată', undefined],
  ] as const)(
    'gives a %s suspension reading "%s" the verdict %s',
    async (cause, reason, verdict) => {
      await suspended('S', new Date('2026-09-12T08:00:00Z'), cause, reason);

      expect((await page()).items[0].rarVerdict).toBe(verdict);
    },
  );
});

// A booking of the garage, cancelled for the given reason at the given time.
async function booking(
  garageId: string,
  cancelReason: BookingCancelReason,
  cancelledAt: Date,
) {
  const driverId = await world.account('Andrei Ion Marin');
  const request = await world.request(driverId, { status: 'booked' });
  const quote = await world.quote(request.id, garageId, 'accepted');
  const { id } = await world.booking(quote.id, 'cancelled');
  // A reason belongs to one side (booking_cancel_reason_side_check).
  const cancelledBySide =
    cancelReason === 'garage_suspended' ? 'system' : 'driver';
  await prisma.booking.update({
    data: { cancelledAt, cancelledBySide, cancelReason },
    where: { id },
  });
}
