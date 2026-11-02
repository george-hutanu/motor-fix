// @traces 093-FR-003 093-FR-004 093-FR-005 093-FR-006
import { type DueCar, dueItems } from './due-items';
import { addDays } from '../../bucharest';

const TODAY = '2026-10-08';
const reading = (km: number, readOn = TODAY) => ({
  createdAt: new Date(`${readOn}T09:00:00Z`),
  km,
  readOn,
});

const car = (extra: Partial<DueCar> = {}): DueCar => ({
  id: '00000000-0000-4000-8000-000000000001',
  itpUntil: null,
  name: 'BMW 320d',
  nextServiceKm: null,
  odometerKm: 148_200,
  readings: [reading(148_200)],
  ...extra,
});

const itpIn = (days: number, extra: Partial<DueCar> = {}) =>
  car({ itpUntil: addDays(TODAY, days), ...extra });

const only = (c: DueCar) => {
  const { items } = dueItems([c], TODAY);
  expect(items).toHaveLength(1);
  return items[0];
};

describe('the state of a dated row', () => {
  it.each([
    [61, 'green'],
    [60, 'amber'],
    [8, 'amber'],
    [7, 'red'],
    [0, 'red'],
    [-1, 'red'],
  ])('is %i days left: %s', (days, state) => {
    expect(only(itpIn(days))).toMatchObject({ daysLeft: days, state });
  });

  it('is passed only once the day is behind', () => {
    expect(only(itpIn(0)).passed).toBe(false);
    expect(only(itpIn(-1)).passed).toBe(true);
  });

  it('is grey with no day and no days left when the car has no ITP date', () => {
    expect(only(car())).toEqual({
      carId: car().id,
      carName: 'BMW 320d',
      daysLeft: null,
      dueKm: null,
      dueOn: null,
      kind: 'itp',
      kmLeft: null,
      passed: false,
      state: 'grey',
    });
  });
});

describe('the ITP row', () => {
  it('carries the date, the days left and no kilometres', () => {
    expect(only(car({ itpUntil: '2026-11-13' }))).toEqual({
      carId: car().id,
      carName: 'BMW 320d',
      daysLeft: 36,
      dueKm: null,
      dueOn: '2026-11-13',
      kind: 'itp',
      kmLeft: null,
      passed: false,
      state: 'amber',
    });
  });
});

describe('the oil service row', () => {
  const oil = (c: DueCar) =>
    dueItems([c], TODAY).items.find((i) => i.kind === 'oil');

  it('carries the kilometres left and the estimated day at the default pace', () => {
    expect(oil(car({ nextServiceKm: 152_000 }))).toEqual({
      carId: car().id,
      carName: 'BMW 320d',
      daysLeft: 116,
      dueKm: 152_000,
      dueOn: '2027-02-01',
      kind: 'oil',
      kmLeft: 3800,
      passed: false,
      state: 'green',
    });
  });

  it('is judged by the days to its estimated day', () => {
    expect(oil(car({ nextServiceKm: 149_500 }))).toMatchObject({
      daysLeft: 40,
      state: 'amber',
    });
    expect(oil(car({ nextServiceKm: 148_400 }))).toMatchObject({
      daysLeft: 6,
      passed: false,
      state: 'red',
    });
  });

  it('is red and passed with no day once the kilometres are reached', () => {
    expect(
      oil(car({ nextServiceKm: 150_000, odometerKm: 150_300 })),
    ).toMatchObject({
      daysLeft: null,
      dueKm: 150_000,
      dueOn: null,
      kmLeft: -300,
      passed: true,
      state: 'red',
    });
    expect(
      oil(car({ nextServiceKm: 150_000, odometerKm: 150_000 })),
    ).toMatchObject({ dueOn: null, kmLeft: 0, passed: true, state: 'red' });
  });

  it('is left out when the car has no next oil service', () => {
    expect(dueItems([itpIn(30)], TODAY).items.map((i) => i.kind)).toEqual([
      'itp',
    ]);
  });
});

describe('the order of the rows', () => {
  const ids = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const rows = (cars: DueCar[]) =>
    dueItems(cars, TODAY).items.map((i) => `${i.kind} ${i.carName}`);

  it('puts the soonest first across cars, with every car its ITP row', () => {
    const bmw = car({
      id: ids(1),
      itpUntil: '2026-11-13',
      nextServiceKm: 152_000,
    });
    const mini = car({
      id: ids(2),
      itpUntil: '2027-06-30',
      name: 'Mini Cooper S',
    });
    expect(rows([mini, bmw])).toEqual([
      'itp BMW 320d',
      'oil BMW 320d',
      'itp Mini Cooper S',
    ]);
  });

  it('puts passed days first, most overdue first, then kilometres over, most over first, then dated, then undated', () => {
    const cars = [
      car({ id: ids(1), name: 'Dacia Logan' }),
      itpIn(10, { id: ids(2), name: 'Audi A4' }),
      itpIn(-2, { id: ids(3), name: 'Ford Focus' }),
      itpIn(-7, { id: ids(4), name: 'Mini Cooper S' }),
      car({
        id: ids(5),
        name: 'Opel Astra',
        nextServiceKm: 150_000,
        odometerKm: 150_100,
      }),
      car({
        id: ids(6),
        name: 'Skoda Octavia',
        nextServiceKm: 150_000,
        odometerKm: 150_900,
      }),
    ];
    expect(rows(cars)).toEqual([
      'itp Mini Cooper S',
      'itp Ford Focus',
      'oil Skoda Octavia',
      'oil Opel Astra',
      'itp Audi A4',
      'itp Dacia Logan',
      'itp Opel Astra',
      'itp Skoda Octavia',
    ]);
  });

  it('orders rows on one day by car name, then ITP before the oil service, then by car', () => {
    // 1,000 km at the default pace is 30 days.
    const cars = [
      itpIn(30, { id: ids(3), name: 'Mini Cooper S' }),
      itpIn(30, { id: ids(2), name: 'BMW 320d', nextServiceKm: 149_200 }),
      itpIn(30, { id: ids(1), name: 'BMW 320d' }),
    ];
    const { items } = dueItems(cars, TODAY);
    expect(items.map((i) => [i.kind, i.carName, i.carId, i.dueOn])).toEqual([
      ['itp', 'BMW 320d', ids(1), addDays(TODAY, 30)],
      ['itp', 'BMW 320d', ids(2), addDays(TODAY, 30)],
      ['oil', 'BMW 320d', ids(2), addDays(TODAY, 30)],
      ['itp', 'Mini Cooper S', ids(3), addDays(TODAY, 30)],
    ]);
  });

  it('gives the same order whatever order the cars come in', () => {
    const cars = [
      car({ id: ids(1), name: 'Dacia Logan' }),
      car({ id: ids(2), name: 'Dacia Logan' }),
      itpIn(5, { id: ids(3), name: 'Audi A4' }),
    ];
    expect(dueItems([...cars].reverse(), TODAY)).toEqual(dueItems(cars, TODAY));
  });
});

// @traces 093-FR-002
describe('the count of items due soon', () => {
  const soon = (cars: DueCar[]) => dueItems(cars, TODAY).dueSoonCount;

  it('counts a passed item and an item at day 60, never day 61', () => {
    expect(soon([itpIn(-3)])).toBe(1);
    expect(soon([itpIn(60)])).toBe(1);
    expect(soon([itpIn(61)])).toBe(0);
  });

  it('never counts an undated or a green row', () => {
    expect(soon([car(), itpIn(200)])).toBe(0);
  });

  it('counts an oil row whose kilometres are reached', () => {
    expect(
      soon([car({ itpUntil: addDays(TODAY, 200), nextServiceKm: 148_200 })]),
    ).toBe(1);
  });

  it('counts an oil row whose estimated day is within 60 days', () => {
    // 1,000 km at the default pace is 30 days.
    expect(
      soon([car({ itpUntil: addDays(TODAY, 200), nextServiceKm: 149_200 })]),
    ).toBe(1);
  });

  it('counts the cars apart from the rows', () => {
    const out = dueItems(
      [car(), itpIn(5, { id: '00000000-0000-4000-8000-000000000002' })],
      TODAY,
    );
    expect(out.carCount).toBe(2);
    expect(out.dueSoonCount).toBe(1);
  });
});
