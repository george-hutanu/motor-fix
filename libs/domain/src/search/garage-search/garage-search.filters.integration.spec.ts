import { randomUUID } from 'node:crypto';

import {
  type ClosedDayAhead,
  filtersOf,
  openStatus,
  type WeeklyHours,
} from '@motor-fix/contracts';
import {
  EVERY_DAY,
  OPEN_STATUS_CASES,
  WEEK,
} from '@motor-fix/contracts/clock-cases.testing';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import type { GarageSearchCache } from './garage-search.cache';
import { GarageSearchService } from './garage-search.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { watchGarageReads } from '../area/area.testing';
import { GaragePinsService } from '../garage-pins/garage-pins.service';
import { SearchLogService } from '../search-log/search-log.service';

type Query = { open_now?: '1'; open_saturday?: '1' };
type Stance = 'works_on' | 'does_not_take';
type Sort = 'rating' | 'distance' | 'price';

const reader = countedMetrics();
const searches = (outcome: string) =>
  counterTotal(reader, 'motorfix_searches_total', { outcome });
const sortChanges = (sort: Sort) =>
  counterTotal(reader, 'motorfix_sort_changes_total', { sort });
const { prisma } = fixtures();
// PostgreSQL's answer every time; garage-search.cache.integration.spec.ts
// covers the cache.
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
const MON_TO_FRI: WeeklyHours = { ...WEEK, sat: [] };
const LUNCH: WeeklyHours = {
  ...WEEK,
  tue: [
    ['08:00', '13:30'],
    ['14:00', '18:00'],
  ],
};

let dacia: string;
// Holidays a case added; the migrations' own rows stay.
let added: string[] = [];

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
});

afterEach(async () => {
  await prisma.publicHoliday.deleteMany({
    where: { day: { in: added.map((day) => new Date(day)) } },
  });
  added = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface Seed {
  name?: string;
  hours?: unknown;
  stance?: Stance;
  closed?: string[];
  kind?: 'company' | 'mobile';
  metres?: number;
  bani?: number;
  // false: a garage with no position, found only by a search with no place.
  placed?: boolean;
}

async function garage({
  bani,
  closed = [],
  hours = WEEK,
  kind = 'company',
  metres = 1000,
  name = `Garage ${randomUUID()}`,
  placed = true,
  stance,
}: Seed = {}) {
  const { id } = await prisma.garage.create({
    data: {
      businessKind: kind,
      hours: hours as object,
      labourFromBani: bani,
      latitude: placed ? PLACE.lat + metres / METRES_PER_DEGREE : null,
      longitude: placed ? PLACE.lng : null,
      name,
      slug: randomUUID(),
      status: 'approved',
      ...(kind === 'mobile' && { seatAddress: 'Strada Sediului 1, București' }),
    },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: dacia,
        garageId: id,
        stance,
        ...(stance === 'does_not_take' && {
          diesel: false,
          electric: false,
          hybrid: false,
          petrol: false,
        }),
      },
    });
  }
  if (closed.length > 0) {
    await prisma.garageClosedDay.createMany({
      data: closed.map((day) => ({ day: new Date(day), garageId: id })),
    });
  }
  return id;
}

async function holiday(day: string) {
  const at = new Date(day);
  if (await prisma.publicHoliday.findUnique({ where: { day: at } })) return;
  await prisma.publicHoliday.create({
    data: { day: at, nameEn: 'Holiday', nameRo: 'Sărbătoare' },
  });
  added.push(day);
}

const page = (query: Query, at: Date, more: { sort?: Sort } = {}) =>
  search.forBrand(
    dacia,
    undefined,
    more.sort === 'distance' ? PLACE : undefined,
    undefined,
    false,
    undefined,
    more.sort,
    filtersOf(query, at),
  );

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
}

// The case's garage: its hours, its closed days, and the holidays stored.
async function garageOfCase(hours: WeeklyHours, closedDays: ClosedDayAhead[]) {
  const holidays = closedDays.filter(({ reason }) => reason === 'holiday');
  for (const { day } of holidays) await holiday(day);
  return garage({
    closed: closedDays
      .filter(({ reason }) => reason === 'closed')
      .map(({ day }) => day),
    hours,
  });
}

// The profile's verdict, with the holiday the database holds for today too.
async function profileSaysOpen(
  hours: WeeklyHours,
  closedDays: ClosedDayAhead[],
  instant: Date,
) {
  const today = filtersOf({ open_now: '1' }, instant)?.openNow?.day ?? '';
  const stored = await prisma.publicHoliday.findUnique({
    where: { day: new Date(today) },
  });
  const shut: ClosedDayAhead[] = stored
    ? [...closedDays, { day: today, reason: 'holiday' }]
    : closedDays;
  return openStatus(hours, shut, instant).kind === 'open';
}

// @traces 1260-FR-002 1260-FR-003 1260-FR-013
describe('open now agrees with the status of a profile', () => {
  it.each(OPEN_STATUS_CASES)(
    'matches exactly when the profile says open, %s',
    async (_title, hours, closedDays, at) => {
      const id = await garageOfCase(hours, closedDays);
      const instant = new Date(at);
      const open = await profileSaysOpen(hours, closedDays, instant);

      const found = await page({ open_now: '1' }, instant);

      expect(found.items.map((item) => item.id)).toEqual(open ? [id] : []);
      expect(found.total).toBe(open ? 1 : 0);
    },
  );

  it.each([
    ['2027-03-28T00:59:00Z'],
    ['2027-03-28T01:00:00Z'],
    ['2027-10-31T00:30:00Z'],
    ['2027-10-31T01:30:00Z'],
  ])(
    'agrees for a garage open 03:00 to 04:00 at %s, when the clock changes',
    async (at) => {
      const night: WeeklyHours = Object.fromEntries(
        Object.keys(EVERY_DAY).map((day) => [day, [['03:00', '04:00']]]),
      ) as WeeklyHours;
      await garage({ hours: night });
      const instant = new Date(at);
      const open = openStatus(night, [], instant).kind === 'open';

      expect((await page({ open_now: '1' }, instant)).total).toBe(open ? 1 : 0);
    },
  );
});

// @traces 1260-FR-002 1260-FR-005 1260-FR-006
describe('open now', () => {
  it('lists and counts only the garages open at the instant, takers first', async () => {
    const taker = await garage({ name: 'Alfa', stance: 'works_on' });
    const other = await garage({ name: 'Beta', stance: 'does_not_take' });
    await garage({ hours: { ...WEEK, tue: [] }, stance: 'works_on' });
    await garage({ hours: {}, stance: 'works_on' });

    const found = await page({ open_now: '1' }, TUESDAY);

    expect(found.items.map((item) => item.id)).toEqual([taker, other]);
    expect(found).toMatchObject({
      counts: { doesNotTake: 1, worksOn: 1 },
      nextCursor: null,
      total: 2,
    });
  });

  it('answers an empty list and zero counts on a legal holiday, with no error', async () => {
    await holiday('2027-12-01');
    await garage({ hours: EVERY_DAY, stance: 'works_on' });

    const found = await page(
      { open_now: '1' },
      new Date('2027-12-01T10:15:00+02:00'),
    );

    expect(found).toMatchObject({
      counts: { doesNotTake: 0, worksOn: 0 },
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('leaves out a garage on its own closed day and lists it the day after', async () => {
    const id = await garage({ closed: ['2027-12-27'], hours: EVERY_DAY });

    expect(
      (await page({ open_now: '1' }, new Date('2027-12-27T10:15:00+02:00')))
        .total,
    ).toBe(0);
    expect(
      (
        await page({ open_now: '1' }, new Date('2027-12-28T10:15:00+02:00'))
      ).items.map((item) => item.id),
    ).toEqual([id]);
  });

  it.each([
    ['13:29', 1],
    ['13:30', 0],
    ['13:59', 0],
    ['14:00', 1],
    ['17:59', 1],
    ['18:00', 0],
  ])('reads a day with a lunch break at %s as %d open', async (time, open) => {
    await garage({ hours: LUNCH });

    expect(
      (await page({ open_now: '1' }, new Date(`2027-11-02T${time}:00+02:00`)))
        .total,
    ).toBe(open);
  });

  it('opens at 13:00 where two intervals touch', async () => {
    await garage({
      hours: {
        ...WEEK,
        tue: [
          ['08:00', '13:00'],
          ['13:00', '18:00'],
        ],
      },
    });

    expect(
      (await page({ open_now: '1' }, new Date('2027-11-02T13:00:00+02:00')))
        .total,
    ).toBe(1);
  });

  it.each([
    ['no hours at all', {}],
    ['a week without the day', { mon: [['08:00', '19:00']] }],
    ['a day that is not a list', { ...WEEK, tue: 'all day' }],
    ['an interval that is not a pair', { ...WEEK, tue: [['08:00']] }],
  ])('never matches a garage with %s', async (_case, hours) => {
    await garage({ hours });

    expect((await page({ open_now: '1' }, TUESDAY)).total).toBe(0);
  });

  it('filters a mobile mechanic on its own hours', async () => {
    const open = await garage({ kind: 'mobile' });
    await garage({ hours: MON_TO_FRI, kind: 'mobile' });

    expect(
      (await page({ open_now: '1' }, SATURDAY)).items.map((item) => item.id),
    ).toEqual([open]);
  });

  it('reads a filtered page in as many statements as an unfiltered one, and no garage by itself', async () => {
    for (let i = 0; i < 3; i++) await garage({ stance: 'works_on' });
    const reads = watchGarageReads(prisma);
    try {
      await page({}, TUESDAY);
      const plain = reads.statements().length;
      await page({ open_now: '1', open_saturday: '1' }, TUESDAY);

      expect(reads.statements().length).toBe(2 * plain);
      expect(reads.counted()).toEqual([]);
    } finally {
      reads.restore();
    }
  });
});

// @traces 1260-FR-004 1260-FR-005
describe('open on Saturday', () => {
  it('lists only the garages with Saturday hours, whatever today is', async () => {
    const saturday = await garage({ name: 'Alfa' });
    await garage({ hours: MON_TO_FRI, name: 'Beta' });

    const found = await page({ open_saturday: '1' }, TUESDAY);

    expect(found.items.map((item) => item.id)).toEqual([saturday]);
    expect(found.total).toBe(1);
  });

  it('matches a garage open on Saturday only', async () => {
    const id = await garage({
      hours: {
        ...MON_TO_FRI,
        fri: [],
        mon: [],
        sat: [['09:00', '14:00']],
        thu: [],
        tue: [],
        wed: [],
      },
    });

    expect(
      (await page({ open_saturday: '1' }, TUESDAY)).items.map(
        (item) => item.id,
      ),
    ).toEqual([id]);
  });

  it.each([
    ['no hours at all', {}],
    ['no Saturday', { mon: [['08:00', '19:00']] }],
    ['an empty Saturday', MON_TO_FRI],
    ['a Saturday that is not a list', { ...WEEK, sat: '09:00-14:00' }],
  ])('never matches a garage with %s', async (_case, hours) => {
    await garage({ hours });

    expect((await page({ open_saturday: '1' }, TUESDAY)).total).toBe(0);
  });

  it('still matches on a closed Saturday and a holiday Saturday', async () => {
    await holiday('2027-11-13');
    const id = await garage({ closed: ['2027-11-06'] });

    for (const at of [SATURDAY, new Date('2027-11-13T10:00:00+02:00')]) {
      expect(
        (await page({ open_saturday: '1' }, at)).items.map((item) => item.id),
      ).toEqual([id]);
    }
  });

  it('combines with open now: open now and on Saturday, not either alone', async () => {
    const both = await garage({ name: 'Alfa' });
    await garage({ hours: MON_TO_FRI, name: 'Beta' });
    await garage({
      hours: { ...WEEK, sat: [['15:00', '18:00']] },
      name: 'Gama',
    });

    const found = await page({ open_now: '1', open_saturday: '1' }, SATURDAY);

    expect(found.items.map((item) => item.id)).toEqual([both]);
    expect(found.total).toBe(1);
  });

  it('answers an empty list and zero counts when nothing meets both', async () => {
    await garage({ hours: MON_TO_FRI, stance: 'works_on' });

    expect(
      await page({ open_now: '1', open_saturday: '1' }, TUESDAY),
    ).toMatchObject({
      counts: { doesNotTake: 0, worksOn: 0 },
      items: [],
      total: 0,
    });
  });

  it.each(['rating', 'distance', 'price'] as const)(
    'keeps the groups and the %s order',
    async (sort) => {
      const near = await garage({
        bani: 20_000,
        metres: 500,
        name: 'Zeta',
        stance: 'does_not_take',
      });
      const far = await garage({
        bani: 10_000,
        metres: 3000,
        name: 'Alfa',
        stance: 'does_not_take',
      });
      const taker = await garage({
        bani: 30_000,
        metres: 2000,
        name: 'Mu',
        stance: 'works_on',
      });
      await garage({ hours: MON_TO_FRI, metres: 100, stance: 'works_on' });
      const others = {
        distance: [near, far],
        price: [far, near],
        rating: [far, near],
      };

      const found = await page({ open_saturday: '1' }, TUESDAY, { sort });

      expect(found.items.map((item) => item.id)).toEqual([
        taker,
        ...others[sort],
      ]);
    },
  );
});

// @traces 1260-FR-005 1260-FR-009
describe('paging a filtered search', () => {
  async function many() {
    for (let i = 0; i < 23; i++) {
      await garage({
        name: `Open ${String(i).padStart(2, '0')}`,
        stance: i % 2 ? 'works_on' : 'does_not_take',
      });
    }
    for (let i = 0; i < 3; i++) await garage({ hours: MON_TO_FRI });
  }

  const next = (cursor: string, query: Query, at = SATURDAY, sort?: Sort) =>
    search.forBrand(
      dacia,
      cursor,
      sort === 'distance' ? PLACE : undefined,
      undefined,
      false,
      undefined,
      sort,
      filtersOf(query, at),
    );

  it.each([
    [{ open_now: '1' }, undefined],
    [{ open_saturday: '1' }, 'price'],
    [{ open_now: '1', open_saturday: '1' }, 'distance'],
  ] as [Query, Sort | undefined][])(
    'gathers exactly the filtered total by following every cursor of %o sorted by %s',
    async (query, sort) => {
      await many();
      const first = await page(query, SATURDAY, { sort });
      const seen = first.items.map((item) => item.id);
      let cursor = first.nextCursor;
      while (cursor) {
        const later = await next(cursor, query, SATURDAY, sort);
        expect(later.total).toBe(first.total);
        seen.push(...later.items.map((item) => item.id));
        cursor = later.nextCursor;
      }

      expect(first.total).toBe(23);
      expect(new Set(seen).size).toBe(23);
      expect(seen).toHaveLength(23);
    },
  );

  it.each([
    ['one added', { open_now: '1' }, { open_now: '1', open_saturday: '1' }],
    ['one removed', { open_now: '1', open_saturday: '1' }, { open_now: '1' }],
    ['another one', { open_now: '1' }, { open_saturday: '1' }],
    ['all removed', { open_saturday: '1' }, {}],
    ['one added to none', {}, { open_now: '1' }],
  ] as [string, Query, Query][])(
    'refuses a cursor with %s as invalid_cursor',
    async (_case, made, presented) => {
      await many();
      const first = await page(made, SATURDAY);
      expect(first.nextCursor).not.toBeNull();

      expect(
        await refusal(next(first.nextCursor ?? '', presented)),
      ).toMatchObject({ body: { code: 'invalid_cursor' }, status: 400 });
    },
  );

  it('keeps the same filters valid at a later instant', async () => {
    await many();
    const first = await page({ open_saturday: '1' }, SATURDAY);

    const later = await next(
      first.nextCursor ?? '',
      { open_saturday: '1' },
      new Date('2027-11-06T10:01:00+02:00'),
    );

    expect(later.items).toHaveLength(3);
  });
});

// @traces 1260-FR-005 1260-FR-006
describe('a filtered search of ids or of a box', () => {
  it('answers only the listed ids that match, with the area’s filtered counts', async () => {
    const open = await garage({ stance: 'works_on' });
    const shut = await garage({ hours: MON_TO_FRI, stance: 'works_on' });
    await garage({ stance: 'does_not_take' });

    const found = await search.byIds(
      dacia,
      [open, shut],
      undefined,
      undefined,
      undefined,
      filtersOf({ open_now: '1' }, SATURDAY),
    );

    expect(found.items.map((item) => item.id)).toEqual([open]);
    expect(found).toMatchObject({
      counts: { doesNotTake: 1, worksOn: 1 },
      total: 2,
    });
  });

  it('chooses the matches among the garages of a box', async () => {
    const inside = await garage({ metres: 1000 });
    await garage({ hours: MON_TO_FRI, metres: 1000 });
    await garage({ metres: 40_000 });

    const found = await search.forBrand(
      dacia,
      undefined,
      undefined,
      undefined,
      false,
      { east: 26.25, north: 44.5, south: 44.35, west: 26 },
      undefined,
      filtersOf({ open_saturday: '1' }, TUESDAY),
    );

    expect(found.items.map((item) => item.id)).toEqual([inside]);
    expect(found.total).toBe(1);
  });
});

// @traces 1260-FR-007
describe('the pins of a filtered search', () => {
  it('carries every garage found, each with whether it matches, and the list’s total', async () => {
    const open = await garage({ metres: 500, stance: 'works_on' });
    const shut = await garage({ hours: MON_TO_FRI, metres: 1000 });
    const query: Query = { open_now: '1' };

    const answer = await pins.forBrand(
      dacia,
      PLACE,
      undefined,
      undefined,
      filtersOf(query, SATURDAY),
    );
    const list = await search.forBrand(
      dacia,
      undefined,
      PLACE,
      undefined,
      false,
      undefined,
      undefined,
      filtersOf(query, SATURDAY),
    );

    expect(answer.pins.map(({ id, matches }) => [id, matches])).toEqual([
      [open, true],
      [shut, false],
    ]);
    expect(answer.total).toBe(1);
    expect(answer.total).toBe(list.total);
  });

  it('marks every pin as matching with no filter', async () => {
    await garage({ metres: 500 });
    await garage({ hours: {}, metres: 1000 });

    const answer = await pins.forBrand(dacia, PLACE);

    expect(answer.pins.map((pin) => pin.matches)).toEqual([true, true]);
    expect(answer.total).toBe(2);
  });

  it('carries every pin as not matching when nothing meets both filters', async () => {
    await garage({ hours: MON_TO_FRI, metres: 500 });

    const answer = await pins.forBrand(
      dacia,
      PLACE,
      undefined,
      undefined,
      filtersOf({ open_now: '1', open_saturday: '1' }, TUESDAY),
    );

    expect(answer.pins.map((pin) => pin.matches)).toEqual([false]);
    expect(answer.total).toBe(0);
  });

  it('counts a matching garage with no position in the total, with no pin, when no place is given', async () => {
    const pinned = await garage({ metres: 500 });
    const unplaced = await garage({ placed: false });
    const shut = await garage({ hours: MON_TO_FRI, metres: 1000 });
    const filters = filtersOf({ open_saturday: '1' }, TUESDAY);

    const answer = await pins.forBrand(
      dacia,
      undefined,
      undefined,
      undefined,
      filters,
    );
    const list = await search.forBrand(
      dacia,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      filters,
    );

    // Nearest to Romania's centre first: the order is not this case's point.
    expect(
      Object.fromEntries(answer.pins.map(({ id, matches }) => [id, matches])),
    ).toEqual({ [pinned]: true, [shut]: false });
    expect(list.items.map((item) => item.id).sort()).toEqual(
      [pinned, unplaced].sort(),
    );
    expect(answer.total).toBe(list.total);
    const matching = answer.pins.filter((pin) => pin.matches).length;
    expect(answer.total - matching).toBe(1);
  });

  it('counts exactly the matching pins when a place is given', async () => {
    await garage({ metres: 500 });
    await garage({ placed: false });
    await garage({ hours: MON_TO_FRI, metres: 1000 });

    const answer = await pins.forBrand(
      dacia,
      PLACE,
      undefined,
      undefined,
      filtersOf({ open_saturday: '1' }, TUESDAY),
    );

    expect(answer.total).toBe(answer.pins.filter((pin) => pin.matches).length);
    expect(answer.total).toBe(1);
  });
});

// @traces 1260-FR-010 1260-FR-014
describe('counting a filtered search', () => {
  it('counts neither a search nor a sort change for a filtered first page without log', async () => {
    await garage();
    const before = {
      none: await searches('none'),
      price: await sortChanges('price'),
      results: await searches('results'),
    };

    await page({ open_saturday: '1' }, TUESDAY);
    await page({ open_now: '1' }, TUESDAY, { sort: 'price' });

    expect({
      none: await searches('none'),
      price: await sortChanges('price'),
      results: await searches('results'),
    }).toEqual(before);
  });

  it('counts one search for a filtered first page with log', async () => {
    await garage();
    const before = await searches('results');

    await search.forBrand(
      dacia,
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      filtersOf({ open_saturday: '1' }, TUESDAY),
    );

    expect(await searches('results')).toBe(before + 1);
  });
});

// @traces 1260-FR-012
describe('a filtered search writes nothing', () => {
  it('leaves the hours, closed days, audit trail, outbox and notifications as they were', async () => {
    const id = await garage({
      closed: ['2027-11-03'],
      hours: LUNCH,
      stance: 'works_on',
    });
    const written = async () => ({
      activity: await prisma.activityLog.count(),
      closedDays: await prisma.garageClosedDay.findMany({
        where: { garageId: id },
      }),
      hours: (await prisma.garage.findUnique({ where: { id } }))?.hours,
      notifications: await prisma.notification.count(),
      outbox: await prisma.outboxEvent.count(),
    });
    const before = await written();

    await page({ open_now: '1', open_saturday: '1' }, TUESDAY);
    await pins.forBrand(
      dacia,
      undefined,
      undefined,
      undefined,
      filtersOf({ open_now: '1', open_saturday: '1' }, TUESDAY),
    );

    expect(await written()).toEqual(before);
  });
});
