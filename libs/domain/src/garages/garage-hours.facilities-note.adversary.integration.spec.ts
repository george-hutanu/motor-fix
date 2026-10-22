import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { writeGarageHours } from './garage-hours';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
const audit = new AuditService();
serialDatabase(databaseUrl);

const CAR = '\u{1F697}';
const NBSP = String.fromCodePoint(0xa0);
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);

let garageId: string;
let actorId: string;

beforeEach(async () => {
  await reset();
  actorId = await account('Mihai Pop', ['garage']);
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const write = (section: Record<string, unknown>) =>
  prisma.$transaction((tx) =>
    writeGarageHours(tx, garageId, section, '2026-10-07', { actorId, audit }),
  );

const note = async () =>
  (
    await prisma.garage.findUniqueOrThrow({
      select: { facilitiesNote: true },
      where: { id: garageId },
    })
  ).facilitiesNote;

const noteEntries = () =>
  prisma.activityLog.count({ where: { field: 'facilitiesNote', garageId } });

const statusOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'written',
    (e: unknown) => (e instanceof HttpException ? e.getStatus() : 'crashed'),
  );

const setRaw = (value: string) =>
  prisma.$executeRaw`UPDATE garage SET facilities_note = ${value} WHERE id = ${garageId}::uuid`;

// @traces 330-FR-004
describe('writing the facilities note at send', () => {
  it('stores 200 astral characters exactly, as the database counts them', async () => {
    await write({ facilitiesNote: CAR.repeat(200) });

    expect(await note()).toBe(CAR.repeat(200));
  });

  it.each([
    ['a line break', 'Doar la\nprogramare'],
    ['null', null],
    ['201 astral characters', CAR.repeat(201)],
  ])(
    'refuses a note holding %s with 400, writing no row, note or history',
    async (_, facilitiesNote) => {
      const status = await statusOf(
        write({ facilities: ['waiting_area'], facilitiesNote }),
      );

      expect(status).toBe(400);
      expect(await prisma.garageFacility.count({ where: { garageId } })).toBe(
        0,
      );
      expect(await note()).toBeNull();
      expect(await noteEntries()).toBe(0);
    },
  );

  it('stores a note of no-break and ideographic spaces as none', async () => {
    await write({ facilitiesNote: `${NBSP}${IDEOGRAPHIC_SPACE}${NBSP}` });

    expect(await note()).toBeNull();
  });

  it('records no history entry for a note of spaces only', async () => {
    await write({ facilitiesNote: '   ' });

    expect(await noteEntries()).toBe(0);
  });
});

// @traces 330-FR-004
describe('the database guarding the facilities note column', () => {
  it.each([
    ['an empty note', ''],
    ['a note of spaces', '    '],
    ['201 astral characters', CAR.repeat(201)],
    ['a note of no-break spaces', NBSP.repeat(2)],
  ])('refuses %s', async (_, value) => {
    await expect(setRaw(value)).rejects.toThrow(/garage_facilities_note_check/);
  });

  it('accepts 200 astral characters', async () => {
    expect(await setRaw(CAR.repeat(200))).toBe(1);
  });
});
