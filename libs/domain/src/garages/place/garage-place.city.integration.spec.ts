import type { PlaceSection } from '@motor-fix/contracts';

import { GaragePlaceService } from './garage-place.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma } = fixtures();
const places = new GaragePlaceService(new AuditService());
serialDatabase(databaseUrl);

const at = { lat: 44.4512, lng: 26.1207 };
let owner = '';
let garageId = '';

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

afterAll(() => prisma.$disconnect());

const write = (section: PlaceSection) =>
  prisma.$transaction((tx) => places.write(tx, owner, garageId, section));

const city = () =>
  prisma.garage.findUniqueOrThrow({
    select: { cityKey: true, cityName: true },
    where: { id: garageId },
  });

// @traces 163-FR-005
describe('the city a saved place records', () => {
  it.each([
    ['Sector 2', 'bucuresti', 'București'],
    ['Bucharest', 'bucuresti', 'București'],
    [' Cluj-Napoca ', 'cluj-napoca', 'Cluj-Napoca'],
    ['Târgu Mureș', 'targu-mures', 'Târgu Mureș'],
  ])('records %s as %s', async (locality, cityKey, cityName) => {
    await write({ address: 'Strada Exemplu 1', ...at, locality });

    await expect(city()).resolves.toEqual({ cityKey, cityName });
  });

  it("records a mobile mechanic's city from its registered seat", async () => {
    await prisma.garage.update({
      data: { businessKind: 'mobile', mobileLegalForm: 'pfa' },
      where: { id: garageId },
    });

    await write({ address: 'Strada Sediului 3', ...at, locality: 'Iași' });

    await expect(city()).resolves.toEqual({
      cityKey: 'iasi',
      cityName: 'Iași',
    });
  });

  it.each([
    ['without a locality', undefined],
    ['with a blank locality', '  '],
    ['with a locality with nothing to key', '— · —'],
  ])('saves the place %s and leaves the city unknown', async (_, locality) => {
    await write({ address: 'Strada Exemplu 1', ...at, locality });

    await expect(city()).resolves.toEqual({ cityKey: null, cityName: null });
    await expect(
      prisma.garage.findUniqueOrThrow({
        select: { address: true },
        where: { id: garageId },
      }),
    ).resolves.toEqual({ address: 'Strada Exemplu 1' });
  });

  it('replaces the city when the place moves, and forgets it when the new one names none', async () => {
    await write({
      address: 'Strada Exemplu 2',
      ...at,
      locality: 'Cluj-Napoca',
    });
    await write({ address: 'Strada Exemplu 1', ...at, locality: 'Sector 3' });

    await expect(city()).resolves.toEqual({
      cityKey: 'bucuresti',
      cityName: 'București',
    });

    await write({ address: 'Strada Exemplu 1', ...at });

    await expect(city()).resolves.toEqual({ cityKey: null, cityName: null });
  });

  it('writes no city when the place is refused', async () => {
    await expect(
      write({ address: '', ...at, locality: 'Cluj-Napoca' }),
    ).rejects.toBeDefined();

    await expect(city()).resolves.toEqual({ cityKey: null, cityName: null });
  });

  it('keeps the city out of the activity history, which records what the owner typed', async () => {
    await write({
      address: 'Strada Exemplu 2',
      ...at,
      locality: 'Cluj-Napoca',
    });

    const fields = (
      await prisma.activityLog.findMany({
        select: { field: true },
        where: { subjectId: garageId },
      })
    ).map(({ field }) => field);
    expect(fields).not.toContain('cityKey');
    expect(fields).not.toContain('cityName');
    expect(fields).not.toContain('locality');
  });
});
