import type { BusinessKind, PlaceSection } from '@motor-fix/contracts';

import { GaragePlaceService } from './garage-place.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { refused } from '../prices/garage-prices.testing';

const { account, prisma } = fixtures();
const places = new GaragePlaceService(new AuditService());
serialDatabase(databaseUrl);

const base: PlaceSection = {
  address: 'Strada Exemplu 1, Sector 3, București',
  lat: 44.4268,
  lng: 26.1025,
};

let owner = '';
let garageId = '';

async function become(businessKind: BusinessKind) {
  await prisma.garage.update({
    data: {
      businessKind,
      mobileLegalForm: businessKind === 'mobile' ? 'pfa' : null,
    },
    where: { id: garageId },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  owner = await account('Mihai Ionescu', ['garage']);
  garageId = (
    await prisma.garage.create({
      data: {
        businessKind: 'company',
        name: 'Service Popescu',
        slug: 'service-popescu',
        status: 'draft',
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const write = (section: PlaceSection, id = garageId) =>
  prisma.$transaction((tx) => places.write(tx, owner, id, section));

const stored = () =>
  prisma.garage.findUniqueOrThrow({
    select: {
      address: true,
      latitude: true,
      longitude: true,
      seatAddress: true,
      serviceRadiusKm: true,
    },
    where: { id: garageId },
  });

const entries = () =>
  prisma.activityLog.findMany({
    where: { garageId, subjectType: 'garage' },
  });

const nothingStored = {
  address: null,
  latitude: null,
  longitude: null,
  seatAddress: null,
  serviceRadiusKm: null,
};

describe('GaragePlaceService.write at its limits', () => {
  it('keeps an address of 200 characters once the padding is trimmed', async () => {
    await write({ ...base, address: `  ${'ș'.repeat(200)}\t ` });

    expect((await stored()).address).toBe('ș'.repeat(200));
  });

  it('refuses 201 characters left after trimming', async () => {
    expect(
      await refused(write({ ...base, address: ` ${'ș'.repeat(201)} ` })),
    ).toEqual([{ code: 'length', field: 'address' }]);
  });

  it.each([
    [43.5, 20.2],
    [48.4, 29.8],
    [43.5, 29.8],
    [48.4, 20.2],
  ])(
    'keeps a position on the corner %d,%d of the country',
    async (lat, lng) => {
      await write({ ...base, lat, lng });

      expect(await stored()).toMatchObject({ latitude: lat, longitude: lng });
    },
  );

  it.each([
    [43.4999, 25],
    [48.4001, 25],
    [45, 20.1999],
    [45, 29.8001],
  ])(
    'refuses the position %d,%d just outside the country',
    async (lat, lng) => {
      expect(await refused(write({ ...base, lat, lng }))).toEqual([
        { code: 'romania', field: 'location' },
      ]);
      expect(await stored()).toEqual(nothingStored);
    },
  );

  it.each([1, 100])('keeps a mobile radius of %d km', async (radiusKm) => {
    await become('mobile');

    await write({ ...base, radiusKm });

    expect((await stored()).serviceRadiusKm).toBe(radiusKm);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1e9, 0.5])(
    'refuses a mobile radius of %p',
    async (radiusKm) => {
      await become('mobile');

      expect(await refused(write({ ...base, radiusKm }))).toEqual([
        { code: 'range', field: 'radiusKm' },
      ]);
      expect(await stored()).toEqual(nothingStored);
    },
  );
});

describe('GaragePlaceService.write against hostile values', () => {
  it.each([
    ['NaN', Number.NaN, 26.1],
    ['infinite', 44.4, Number.POSITIVE_INFINITY],
    ['string', '44.4' as unknown as number, '26.1' as unknown as number],
    ['null', null as unknown as number, null as unknown as number],
    ['swapped', 26.1025, 44.4268],
  ])(
    'refuses %s coordinates as a refusal, not a database error',
    async (_, lat, lng) => {
      const errors = await refused(write({ ...base, lat, lng }));

      expect(errors.map(({ field }) => field)).toEqual(['location']);
      expect(await stored()).toEqual(nothingStored);
    },
  );

  it('refuses an address holding a NUL character as a refusal, not a database error', async () => {
    const errors = await refused(write({ ...base, address: 'Strada\u0000 1' }));

    expect(errors.map(({ field }) => field)).toEqual(['address']);
    expect(await stored()).toEqual(nothingStored);
  });

  it('refuses a non-string address as a refusal, not a crash', async () => {
    const errors = await refused(
      write({ ...base, address: 42 as unknown as string }),
    );

    expect(errors).toEqual([{ code: 'required', field: 'address' }]);
  });

  it('reports the address and the position when both are wrong', async () => {
    const errors = await refused(write({ address: '  ', lat: 10, lng: 10 }));

    expect(errors).toEqual(
      expect.arrayContaining([
        { code: 'required', field: 'address' },
        { code: 'romania', field: 'location' },
      ]),
    );
    expect(errors).toHaveLength(2);
  });

  it('keeps an address of emoji and combining marks as typed', async () => {
    const address = 'Strada Cîne 🚗 nr. 5';

    await write({ ...base, address });

    expect((await stored()).address).toBe(address);
  });

  it('keeps the SQL-looking address as plain text', async () => {
    const address = "x'); DELETE FROM garage; --";

    await write({ ...base, address });

    expect((await stored()).address).toBe(address);
    expect(await prisma.garage.count()).toBe(1);
  });

  it('fails on a garage that does not exist and leaves no history', async () => {
    await expect(
      write(base, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow();

    expect(
      await prisma.activityLog.count({
        where: { garageId: '00000000-0000-4000-8000-000000000000' },
      }),
    ).toBe(0);
  });
});

describe('GaragePlaceService.write across kinds and repeats', () => {
  it('moves a former mobile mechanic back to a public address with no seat and no radius', async () => {
    await become('mobile');
    await write({ ...base, radiusKm: 40 });

    await become('company');
    await write({
      ...base,
      address: 'Strada Nouă 9, Iași',
      lat: 47.16,
      lng: 27.59,
    });

    expect(await stored()).toEqual({
      address: 'Strada Nouă 9, Iași',
      latitude: 47.16,
      longitude: 27.59,
      seatAddress: null,
      serviceRadiusKm: null,
    });
  });

  it('moves a workshop turned mobile to a seat with no public address', async () => {
    await write(base);

    await become('mobile');
    await write({ ...base, radiusKm: 15 });

    expect(await stored()).toEqual({
      address: null,
      latitude: 44.4268,
      longitude: 26.1025,
      seatAddress: base.address,
      serviceRadiusKm: 15,
    });
  });

  it('is the same stored result when run twice with the same section', async () => {
    await write(base);
    const once = await stored();
    await write(base);

    expect(await stored()).toEqual(once);
  });

  it('adds no history entries when the same section is written again', async () => {
    await write(base);
    const first = (await entries()).length;

    await write(base);

    expect((await entries()).length).toBe(first);
  });

  it('records the earlier value as the old one when the place is written anew', async () => {
    await write(base);

    await write({
      ...base,
      address: 'Strada Alta 2, Cluj-Napoca',
      lat: 46.77,
      lng: 23.6,
    });

    const addressEntries = (await entries())
      .filter(({ field }) => field === 'address')
      .map(({ newValue, oldValue }) => ({ newValue, oldValue }));
    expect(addressEntries).toEqual(
      expect.arrayContaining([
        { newValue: 'Strada Alta 2, Cluj-Napoca', oldValue: base.address },
      ]),
    );
  });

  it('records a mobile mechanic under the seat, never the public address, and the radius', async () => {
    await become('mobile');

    await write(base);

    const fields = (await entries()).map(({ field }) => field);
    expect(fields).not.toContain('address');
    expect(fields).toEqual(expect.arrayContaining(['seatAddress', 'location']));
  });

  it('puts nothing in the outbox and no notification', async () => {
    const events = await prisma.outboxEvent.count();
    const notices = await prisma.notification.count();

    await write(base);

    expect(await prisma.outboxEvent.count()).toBe(events);
    expect(await prisma.notification.count()).toBe(notices);
  });

  it('writes nothing when a refused write follows a good one in the same transaction', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await places.write(tx, owner, garageId, base);
        await places.write(tx, owner, garageId, { address: '' });
      }),
    ).rejects.toThrow();

    expect(await stored()).toEqual(nothingStored);
    expect(await entries()).toEqual([]);
  });
});
