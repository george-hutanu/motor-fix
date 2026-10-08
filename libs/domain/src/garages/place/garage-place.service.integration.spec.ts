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

const workshop: PlaceSection = {
  address: '  Strada Ștefan cel Mare 12, Sector 2, București ',
  lat: 44.4512,
  lng: 26.1207,
};

let owner = '';
let garageId = '';
let since = new Date(0);

async function garageOf(businessKind: BusinessKind) {
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
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const write = (section: PlaceSection) =>
  prisma.$transaction((tx) => places.write(tx, owner, garageId, section));

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

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { at: { gte: since }, subjectType: 'garage' },
  });

describe('GaragePlaceService.write', () => {
  it('keeps a workshop at its public address and position', async () => {
    await write(workshop);

    expect(await stored()).toEqual({
      address: 'Strada Ștefan cel Mare 12, Sector 2, București',
      latitude: 44.4512,
      longitude: 26.1207,
      seatAddress: null,
      serviceRadiusKm: null,
    });
  });

  it('drops a radius given for a workshop', async () => {
    await write({ ...workshop, radiusKm: 30 });

    expect((await stored()).serviceRadiusKm).toBeNull();
  });

  it('keeps a mobile mechanic at the seat, out of the public address, with the radius', async () => {
    await garageOf('mobile');

    await write({ ...workshop, radiusKm: 35 });

    expect(await stored()).toEqual({
      address: null,
      latitude: 44.4512,
      longitude: 26.1207,
      seatAddress: 'Strada Ștefan cel Mare 12, Sector 2, București',
      serviceRadiusKm: 35,
    });
  });

  it('gives a mobile mechanic with no radius the default 20 km', async () => {
    await garageOf('mobile');

    await write(workshop);

    expect((await stored()).serviceRadiusKm).toBe(20);
  });

  it('records one entry per field it wrote, by the owner', async () => {
    await write(workshop);

    const entries = await history();
    expect(
      entries.map(({ action, actorId, field, newValue, oldValue }) => ({
        action,
        actorId,
        field,
        newValue,
        oldValue,
      })),
    ).toEqual([
      {
        action: 'update',
        actorId: owner,
        field: 'address',
        newValue: 'Strada Ștefan cel Mare 12, Sector 2, București',
        oldValue: null,
      },
      {
        action: 'update',
        actorId: owner,
        field: 'location',
        newValue: { lat: 44.4512, lng: 26.1207 },
        oldValue: null,
      },
    ]);
    expect(entries.every((entry) => entry.garageId === garageId)).toBe(true);
  });

  it.each([
    ['no position', { address: 'Strada Exemplu 1' }, 'required', 'location'],
    [
      'a position outside Romania',
      { address: 'Wien', lat: 48.2, lng: 16.37 },
      'romania',
      'location',
    ],
    [
      'a latitude with no longitude',
      { address: 'Strada Exemplu 1', lat: 44.4 },
      'required',
      'location',
    ],
    ['no address', { lat: 44.4, lng: 26.1 }, 'required', 'address'],
    [
      'a blank address',
      { address: '   ', lat: 44.4, lng: 26.1 },
      'required',
      'address',
    ],
    [
      'an address over 200 characters',
      { address: 'x'.repeat(201), lat: 44.4, lng: 26.1 },
      'length',
      'address',
    ],
  ] as [string, PlaceSection, string, string][])(
    'refuses %s and writes nothing',
    async (_, section, code, field) => {
      expect(await refused(write(section))).toEqual([{ code, field }]);
      expect(await stored()).toEqual({
        address: null,
        latitude: null,
        longitude: null,
        seatAddress: null,
        serviceRadiusKm: null,
      });
      expect(await history()).toEqual([]);
    },
  );

  it('refuses a workshop a radius out of range too', async () => {
    expect(await refused(write({ ...workshop, radiusKm: 101 }))).toEqual([
      { code: 'range', field: 'radiusKm' },
    ]);
    expect((await stored()).address).toBeNull();
  });

  it.each([0, 101, 12.5])(
    'refuses a mobile mechanic a radius of %d km',
    async (radiusKm) => {
      await garageOf('mobile');

      expect(await refused(write({ ...workshop, radiusKm }))).toEqual([
        { code: 'range', field: 'radiusKm' },
      ]);
      expect((await stored()).serviceRadiusKm).toBeNull();
    },
  );

  it('leaves nothing behind when the caller fails after the write', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await places.write(tx, owner, garageId, workshop);
        throw new Error('the sending failed later');
      }),
    ).rejects.toThrow('the sending failed later');

    expect((await stored()).address).toBeNull();
    expect(await history()).toEqual([]);
  });

  it.each([
    ['an empty address', { address: '' }],
    ['an empty seat', { seatAddress: '' }],
    [
      'both an address and a seat',
      { address: 'Strada A 1', seatAddress: 'Strada B 2' },
    ],
  ])('is held by the database to never keep %s', async (_, data) => {
    await expect(
      prisma.garage.update({ data, where: { id: garageId } }),
    ).rejects.toThrow();
  });

  // Romania's box lives only in the contracts library (FR-007): the
  // database holds a position to the earth's ranges (FR-012), no tighter.
  it('is held by the database to a position on the earth, not to Romania', async () => {
    await prisma.garage.update({
      data: { latitude: 52.52, longitude: 13.4 },
      where: { id: garageId },
    });
    expect(await stored()).toMatchObject({ latitude: 52.52, longitude: 13.4 });
    for (const data of [
      { latitude: 90.0001, longitude: 0 },
      { latitude: -90.0001, longitude: 0 },
      { latitude: 0, longitude: 180.0001 },
      { latitude: 0, longitude: -180.0001 },
      { latitude: 44.4, longitude: null },
    ])
      await expect(
        prisma.garage.update({ data, where: { id: garageId } }),
      ).rejects.toThrow();
  });
});
