import { randomUUID } from 'node:crypto';

import { filtersOf, type WeeklyHours } from '@motor-fix/contracts';
import { WEEK } from '@motor-fix/contracts/clock-cases.testing';
import { HttpException } from '@nestjs/common';

import type { GarageSearchCache } from './garage-search.cache';
import { GarageSearchService } from './garage-search.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { GaragePinsService } from '../garage-pins/garage-pins.service';
import { SearchLogService } from '../search-log/search-log.service';

type Query = { open_now?: '1'; open_saturday?: '1' };

const { prisma } = fixtures();
const uncached = {
  entry: (_key, read) => read(),
} satisfies Pick<GarageSearchCache, 'entry'> as unknown as GarageSearchCache;
const search = new GarageSearchService(
  prisma,
  uncached,
  new SearchLogService(prisma),
);
const pins = new GaragePinsService(prisma, uncached);
serialDatabase(databaseUrl);

const PLACE = { lat: 44.437, lng: 26.117 };
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;
const TUESDAY = new Date('2027-11-02T10:15:00+02:00');
const SATURDAY = new Date('2027-11-06T10:00:00+02:00');

let dacia: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function garage(hours: unknown, closed: string[] = []) {
  const { id } = await prisma.garage.create({
    data: {
      businessKind: 'company',
      hours: hours as object,
      latitude: PLACE.lat + 1000 / METRES_PER_DEGREE,
      longitude: PLACE.lng,
      name: `Garage ${randomUUID()}`,
      slug: randomUUID(),
      status: 'approved',
    },
  });
  for (const day of closed) {
    await prisma.garageClosedDay.create({
      data: { day: new Date(day), garageId: id },
    });
  }
  return id;
}

const page = (query: Query, at: Date) =>
  search.forBrand(
    dacia,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    filtersOf(query, at),
  );

const pinsOf = (query: Query, at: Date) =>
  pins.forBrand(dacia, PLACE, undefined, undefined, filtersOf(query, at));

const NOT_A_LIST: [string, unknown][] = [
  ['a string', 'x'],
  ['null', null],
  ['an object', { 0: ['09:00', '14:00'] }],
  ['a number', 7],
  ['a boolean', true],
];

// @traces 1260-FR-002 1260-FR-004
describe('hours that are not a week, read by the filters', () => {
  it.each(NOT_A_LIST)(
    'never matches open on Saturday when Saturday is %s, and the search still answers',
    async (_name, saturday) => {
      await garage({ ...WEEK, sat: saturday });
      const ok = await garage(WEEK);

      const found = await page({ open_saturday: '1' }, TUESDAY);

      expect(found.items.map((item) => item.id)).toEqual([ok]);
      expect(found.total).toBe(1);
    },
  );

  it.each(NOT_A_LIST)(
    'never matches open now when Tuesday is %s, and the search still answers',
    async (_name, tuesday) => {
      await garage({ ...WEEK, tue: tuesday });
      const ok = await garage(WEEK);

      const found = await page({ open_now: '1' }, TUESDAY);

      expect(found.items.map((item) => item.id)).toEqual([ok]);
      expect(found.total).toBe(1);
    },
  );

  it.each([
    ['an array', []],
    ['an array of strings', ['mon', 'sat']],
    ['a string', 'always open'],
    ['a number', 0],
    ['an empty object', {}],
  ])(
    'never matches either filter when the stored hours are %s',
    async (_n, hours) => {
      await garage(hours);
      await garage(WEEK);

      const both = await page({ open_now: '1', open_saturday: '1' }, SATURDAY);
      const sat = await page({ open_saturday: '1' }, TUESDAY);
      const now = await page({ open_now: '1' }, TUESDAY);

      expect([both.total, sat.total, now.total]).toEqual([1, 1, 1]);
    },
  );

  it('never matches open on Saturday for a Saturday kept under a different key', async () => {
    await garage({
      ...WEEK,
      Sat: [['09:00', '14:00']],
      sat: undefined,
      saturday: [['09:00', '14:00']],
    });

    expect((await page({ open_saturday: '1' }, TUESDAY)).total).toBe(0);
  });

  it('pins every garage with an unreadable week as not matching, without an error', async () => {
    const odd = await garage({ ...WEEK, sat: 'x', tue: 'x' });
    const ok = await garage(WEEK);

    const answer = await pinsOf(
      { open_now: '1', open_saturday: '1' },
      SATURDAY,
    );

    expect(answer.pins.map(({ id, matches }) => [id, matches]).sort()).toEqual(
      [
        [odd, false],
        [ok, true],
      ].sort(),
    );
    expect(answer.total).toBe(1);
  });
});

// @traces 1260-FR-002
describe('open now at the millisecond edge of an interval', () => {
  const at = (time: string) => new Date(`2027-11-02T${time}+02:00`);

  it.each([
    ['one millisecond before opening', '07:59:59.999', 0],
    ['the opening millisecond', '08:00:00.000', 1],
    ['the last millisecond of the last minute', '17:59:59.999', 1],
    ['the closing millisecond', '18:00:00.000', 0],
  ])('answers %s', async (_name, time, total) => {
    await garage({ ...WEEK, tue: [['08:00', '18:00']] });

    expect((await page({ open_now: '1' }, at(time))).total).toBe(total);
  });

  it('is open at 23:59 on an interval that ends at 24:00', async () => {
    await garage({ ...WEEK, tue: [['20:00', '24:00']] });

    expect((await page({ open_now: '1' }, at('23:59:59.999'))).total).toBe(1);
  });

  it('is closed at 00:00 the next day when the interval ended at 24:00', async () => {
    await garage({ ...WEEK, tue: [['20:00', '24:00']], wed: [] });

    expect(
      (await page({ open_now: '1' }, new Date('2027-11-03T00:00:00+02:00')))
        .total,
    ).toBe(0);
  });

  it('is open on a day whose first interval starts at 00:00', async () => {
    await garage({ ...WEEK, tue: [['00:00', '06:00']] });

    expect((await page({ open_now: '1' }, at('00:00:00.000'))).total).toBe(1);
  });
});

// @traces 1260-FR-002
describe('closed days belong to their own garage and their own day', () => {
  it('leaves a garage open when only another garage closed today', async () => {
    await garage(WEEK, ['2027-11-02']);
    const open = await garage(WEEK);

    const found = await page({ open_now: '1' }, TUESDAY);

    expect(found.items.map((item) => item.id)).toEqual([open]);
  });

  it('uses the Bucharest date for a closed day when the UTC date is still the day before', async () => {
    const id = await garage(WEEK, ['2027-11-03']);

    const found = await page(
      { open_now: '1' },
      new Date('2027-11-02T22:30:00Z'),
    );

    expect(found.items.map((item) => item.id)).not.toContain(id);
  });

  it('keeps a garage that closed a Saturday matching open on Saturday', async () => {
    const id = await garage(WEEK, ['2027-11-06']);

    const found = await page({ open_saturday: '1' }, SATURDAY);

    expect(found.items.map((item) => item.id)).toEqual([id]);
  });
});

// @traces 1260-FR-009
describe('a hostile cursor under filters', () => {
  const read = (cursor: string) =>
    search
      .forBrand(
        dacia,
        cursor,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        filtersOf({ open_now: '1' }, TUESDAY),
      )
      .then(
        () => undefined,
        (thrown: unknown) =>
          thrown instanceof HttpException ? thrown.getResponse() : thrown,
      );

  it.each([
    ['empty-looking base64', Buffer.from('').toString('base64url')],
    ['json null', Buffer.from('null').toString('base64url')],
    [
      'json with the filters as numbers',
      Buffer.from('{"f":1}').toString('base64url'),
    ],
    [
      'json with the filters as an object',
      Buffer.from('{"f":{"openNow":true}}').toString('base64url'),
    ],
    ['plain text', 'not a cursor'],
  ])('refuses %s as invalid_cursor', async (_name, cursor) => {
    await garage(WEEK);

    expect(await read(cursor)).toMatchObject({ code: 'invalid_cursor' });
  });
});

// @traces 1260-FR-006 1260-FR-007
describe('a filtered search with nothing found at all', () => {
  it('answers an empty list, zero counts and no pins for a brand with no garage', async () => {
    const list = await page({ open_now: '1', open_saturday: '1' }, SATURDAY);
    const answer = await pinsOf(
      { open_now: '1', open_saturday: '1' },
      SATURDAY,
    );

    expect(list).toMatchObject({
      counts: { doesNotTake: 0, worksOn: 0 },
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect(answer).toMatchObject({ pins: [], total: 0 });
  });

  it('keeps the unfiltered week untouched by a filtered read', async () => {
    const hours: WeeklyHours = { ...WEEK };
    const id = await garage(hours);
    await page({ open_now: '1' }, TUESDAY);

    const stored = await prisma.garage.findUniqueOrThrow({ where: { id } });
    expect(stored.hours).toEqual(hours);
  });
});
