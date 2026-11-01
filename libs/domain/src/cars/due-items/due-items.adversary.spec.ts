// @traces 093-FR-002
import { type DueCar, dueItems } from './due-items';
import { addDays } from '../../bucharest';

const TODAY = '2026-10-08';
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const reading = (km: number, readOn: string, hour = 9) => ({
  createdAt: new Date(`${readOn}T${String(hour).padStart(2, '0')}:00:00Z`),
  km,
  readOn,
});

const car = (extra: Partial<DueCar> = {}): DueCar => ({
  id: ID(1),
  itpUntil: null,
  name: 'BMW 320d',
  nextServiceKm: null,
  odometerKm: 148_200,
  readings: [reading(148_200, TODAY)],
  ...extra,
});

const itpIn = (days: number, extra: Partial<DueCar> = {}, today = TODAY) =>
  car({ itpUntil: addDays(today, days), ...extra });

const order = (cars: DueCar[], today = TODAY) =>
  dueItems(cars, today).items.map((i) => `${i.kind}:${i.carName}`);

describe('an empty and a single input', () => {
  it('answers no rows and zero counts for no cars', () => {
    expect(dueItems([], TODAY)).toEqual({
      carCount: 0,
      dueSoonCount: 0,
      items: [],
    });
  });

  it('counts a bare car once and gives it one grey undated row', () => {
    const out = dueItems([car()], TODAY);
    expect(out.carCount).toBe(1);
    expect(out.dueSoonCount).toBe(0);
    expect(out.items.map((i) => [i.kind, i.state, i.dueOn])).toEqual([
      ['itp', 'grey', null],
    ]);
  });
});

describe('the count of items due soon', () => {
  const soon = (cars: DueCar[]) => dueItems(cars, TODAY).dueSoonCount;

  it.each([
    [-1, 1],
    [0, 1],
    [7, 1],
    [8, 1],
    [59, 1],
    [60, 1],
    [61, 0],
    [400, 0],
  ])('counts an ITP %i days away as %i', (days, count) => {
    expect(soon([itpIn(days)])).toBe(count);
  });

  it('never counts an undated row', () => {
    expect(soon([car(), car({ id: ID(2) })])).toBe(0);
  });

  it('counts an oil row whose kilometres are reached, with no day', () => {
    expect(soon([car({ nextServiceKm: 148_200 })])).toBe(1);
    expect(soon([car({ nextServiceKm: 100_000 })])).toBe(1);
  });

  it('does not count an oil row that is green', () => {
    expect(soon([car({ nextServiceKm: 152_000 })])).toBe(0);
  });

  it('counts an oil row whose estimated day is within 60 days', () => {
    expect(soon([car({ nextServiceKm: 149_500 })])).toBe(1);
  });

  it('counts the ITP row and the oil row of one car separately', () => {
    expect(soon([itpIn(3, { nextServiceKm: 148_201 })])).toBe(2);
  });

  it('equals the number of red or amber rows in a mixed set', () => {
    const cars = [-30, -1, 0, 7, 8, 60, 61, 90].map((d, i) =>
      itpIn(d, { id: ID(i + 1), name: `Car ${i}`, nextServiceKm: 160_000 }),
    );
    const out = dueItems(cars, TODAY);
    const redOrAmber = out.items.filter(
      (i) => i.state === 'red' || i.state === 'amber',
    ).length;
    expect(out.dueSoonCount).toBe(redOrAmber);
    expect(out.carCount).toBe(8);
  });
});

describe('whole calendar days across clock changes and years', () => {
  it('counts one day from 24 to 25 October 2026 and one from 25 to 26', () => {
    const a = dueItems([car({ itpUntil: '2026-10-25' })], '2026-10-24');
    const b = dueItems([car({ itpUntil: '2026-10-26' })], '2026-10-25');
    expect([a.items[0].daysLeft, b.items[0].daysLeft]).toEqual([1, 1]);
  });

  it('counts two days from 24 to 26 October 2026 across the change', () => {
    const out = dueItems([car({ itpUntil: '2026-10-26' })], '2026-10-24');
    expect(out.items[0].daysLeft).toBe(2);
  });

  it('counts a negative day across the autumn change', () => {
    const out = dueItems([car({ itpUntil: '2026-10-24' })], '2026-10-26');
    expect(out.items[0]).toMatchObject({
      daysLeft: -2,
      passed: true,
      state: 'red',
    });
  });

  it('counts 60 days exactly across the autumn change as amber and counted', () => {
    const out = dueItems([car({ itpUntil: '2026-12-23' })], '2026-10-24');
    expect(out.items[0]).toMatchObject({ daysLeft: 60, state: 'amber' });
    expect(out.dueSoonCount).toBe(1);
  });

  it('counts 61 days across the autumn change as green and not counted', () => {
    const out = dueItems([car({ itpUntil: '2026-12-24' })], '2026-10-24');
    expect(out.items[0]).toMatchObject({ daysLeft: 61, state: 'green' });
    expect(out.dueSoonCount).toBe(0);
  });

  it('counts across the spring change of 2027', () => {
    const out = dueItems([car({ itpUntil: '2027-03-29' })], '2027-03-27');
    expect(out.items[0].daysLeft).toBe(2);
  });

  it('counts one day over New Year', () => {
    const out = dueItems([car({ itpUntil: '2027-01-01' })], '2026-12-31');
    expect(out.items[0]).toMatchObject({ daysLeft: 1, state: 'red' });
  });

  it('counts 0 days on 1 January and -1 the day after', () => {
    expect(
      dueItems([car({ itpUntil: '2027-01-01' })], '2027-01-01').items[0],
    ).toMatchObject({ daysLeft: 0, passed: false });
    expect(
      dueItems([car({ itpUntil: '2027-01-01' })], '2027-01-02').items[0],
    ).toMatchObject({ daysLeft: -1, passed: true });
  });

  it('counts a leap day: 28 February to 1 March 2028 is two days', () => {
    const out = dueItems([car({ itpUntil: '2028-03-01' })], '2028-02-28');
    expect(out.items[0].daysLeft).toBe(2);
  });

  it('counts a full non-leap year as 365 and a leap year as 366', () => {
    expect(
      dueItems([car({ itpUntil: '2027-01-01' })], '2026-01-01').items[0]
        .daysLeft,
    ).toBe(365);
    expect(
      dueItems([car({ itpUntil: '2029-01-01' })], '2028-01-01').items[0]
        .daysLeft,
    ).toBe(366);
  });

  it('counts a date more than a year passed', () => {
    const out = dueItems([car({ itpUntil: '2025-01-01' })], '2026-10-08');
    expect(out.items[0]).toMatchObject({
      daysLeft: -645,
      passed: true,
      state: 'red',
    });
  });

  it('answers a date in year 9999 as green with a finite count', () => {
    const out = dueItems([car({ itpUntil: '9999-12-31' })], TODAY);
    expect(out.items[0].state).toBe('green');
    expect(Number.isInteger(out.items[0].daysLeft)).toBe(true);
  });
});

describe('the oil service row at its edges', () => {
  const oil = (c: DueCar, today = TODAY) =>
    dueItems([c], today).items.find((i) => i.kind === 'oil');

  it('answers a row for a next service of 0 km on an odometer of 0', () => {
    expect(oil(car({ nextServiceKm: 0, odometerKm: 0, readings: [] }))).toEqual(
      {
        carId: ID(1),
        carName: 'BMW 320d',
        daysLeft: null,
        dueKm: 0,
        dueOn: null,
        kind: 'oil',
        kmLeft: 0,
        passed: true,
        state: 'red',
      },
    );
  });

  it('answers a row for a next service of 0 km on a driven car', () => {
    expect(oil(car({ nextServiceKm: 0 }))).toMatchObject({
      dueKm: 0,
      kmLeft: -148_200,
      passed: true,
      state: 'red',
    });
  });

  it('is one kilometre left: not passed, with a day', () => {
    const row = oil(car({ nextServiceKm: 148_201 }));
    expect(row).toMatchObject({ kmLeft: 1, passed: false });
    expect(row?.dueOn).not.toBeNull();
    expect(Number.isInteger(row?.daysLeft)).toBe(true);
  });

  it('is judged on the car odometer even with no readings', () => {
    const row = oil(car({ nextServiceKm: 152_000, readings: [] }));
    expect(row).toMatchObject({ kmLeft: 3800, passed: false });
    expect(row?.dueOn).not.toBeNull();
  });

  it('gives the same estimated day whatever order the readings come in', () => {
    const readings = [
      reading(147_000, '2026-08-01'),
      reading(147_600, '2026-09-01'),
      reading(148_200, TODAY),
    ];
    const a = oil(car({ nextServiceKm: 150_000, readings }));
    const b = oil(
      car({ nextServiceKm: 150_000, readings: [...readings].reverse() }),
    );
    expect(b).toEqual(a);
  });

  it('is red but not passed within 7 days of its estimated day', () => {
    expect(oil(car({ nextServiceKm: 148_400 }))).toMatchObject({
      passed: false,
      state: 'red',
    });
  });

  it('sets daysLeft to the distance between today and dueOn', () => {
    const row = oil(car({ nextServiceKm: 151_000 }));
    const gap =
      (Date.parse(`${row?.dueOn}T00:00:00Z`) -
        Date.parse(`${TODAY}T00:00:00Z`)) /
      86_400_000;
    expect(row?.daysLeft).toBe(gap);
  });

  it('answers the same for the same input called twice', () => {
    const cars = [car({ itpUntil: '2026-12-01', nextServiceKm: 151_000 })];
    expect(dueItems(cars, TODAY)).toEqual(dueItems(cars, TODAY));
  });
});

describe('passed oil against passed date', () => {
  it('puts a passed date one day behind before a passed oil row', () => {
    const cars = [
      car({ id: ID(1), name: 'Aaa', nextServiceKm: 100_000 }),
      itpIn(-1, { id: ID(2), name: 'Zzz' }),
    ];
    expect(order(cars)).toEqual(['itp:Zzz', 'oil:Aaa', 'itp:Aaa']);
  });

  it('puts a passed oil row before an ITP due today', () => {
    const cars = [
      itpIn(0, { id: ID(1), name: 'Aaa' }),
      car({ id: ID(2), name: 'Zzz', nextServiceKm: 148_200 }),
    ];
    expect(order(cars)).toEqual(['oil:Zzz', 'itp:Aaa', 'itp:Zzz']);
  });

  it('puts an oil row at exactly 0 km left with the passed rows', () => {
    const cars = [
      itpIn(1, { id: ID(1), name: 'Aaa' }),
      car({ id: ID(2), name: 'Zzz', nextServiceKm: 148_200 }),
    ];
    expect(order(cars)[0]).toBe('oil:Zzz');
  });

  it('keeps every passed date row before every passed oil row however far over', () => {
    const cars = [
      car({ id: ID(1), name: 'A', nextServiceKm: 1, odometerKm: 900_000 }),
      itpIn(-1, { id: ID(2), name: 'B' }),
      itpIn(-300, { id: ID(3), name: 'C' }),
    ];
    expect(order(cars).slice(0, 3)).toEqual(['itp:C', 'itp:B', 'oil:A']);
  });

  it('orders passed oil rows by kilometres over, then name, then car id', () => {
    const over = (id: number, name: string, odo: number) =>
      car({ id: ID(id), name, nextServiceKm: 100_000, odometerKm: odo });
    const cars = [
      over(4, 'B', 100_500),
      over(3, 'A', 100_500),
      over(2, 'A', 100_500),
      over(1, 'Z', 101_000),
    ];
    const rows = dueItems(cars, TODAY).items.filter((i) => i.kind === 'oil');
    expect(rows.map((i) => i.carId)).toEqual([ID(1), ID(2), ID(3), ID(4)]);
  });

  it('orders passed dates on one day by name, then car id', () => {
    const cars = [
      itpIn(-5, { id: ID(3), name: 'B' }),
      itpIn(-5, { id: ID(2), name: 'A' }),
      itpIn(-5, { id: ID(1), name: 'A' }),
    ];
    expect(dueItems(cars, TODAY).items.map((i) => i.carId)).toEqual([
      ID(1),
      ID(2),
      ID(3),
    ]);
  });
});

describe('ties and the dated order', () => {
  it('sorts a dated oil row among ITP rows by day', () => {
    const cars = [
      itpIn(50, { id: ID(1), name: 'A' }),
      itpIn(90, { id: ID(2), name: 'B', nextServiceKm: 149_500 }),
    ];
    expect(order(cars)).toEqual(['oil:B', 'itp:A', 'itp:B']);
  });

  it('puts an ITP before the oil row of the same car on the same day', () => {
    const c = itpIn(30, { nextServiceKm: 149_200 });
    expect(dueItems([c], TODAY).items.map((i) => i.kind)).toEqual([
      'itp',
      'oil',
    ]);
  });

  it('puts the oil row of an earlier-named car before the ITP of a later one on one day', () => {
    const cars = [
      itpIn(30, { id: ID(1), name: 'Zeta' }),
      car({ id: ID(2), name: 'Alfa', nextServiceKm: 149_200 }),
    ];
    expect(order(cars)).toEqual(['oil:Alfa', 'itp:Zeta', 'itp:Alfa']);
  });

  it('orders undated rows by name then car id', () => {
    const cars = [
      car({ id: ID(3), name: 'B' }),
      car({ id: ID(2), name: 'A' }),
      car({ id: ID(1), name: 'A' }),
    ];
    expect(dueItems(cars, TODAY).items.map((i) => i.carId)).toEqual([
      ID(1),
      ID(2),
      ID(3),
    ]);
  });

  it('orders the same by a car-name tie on identical cars read in any order', () => {
    const cars = [1, 2, 3, 4].map((n) => itpIn(12, { id: ID(n) }));
    const forward = dueItems(cars, TODAY);
    expect(dueItems([...cars].reverse(), TODAY)).toEqual(forward);
    expect(forward.items.map((i) => i.carId)).toEqual([
      ID(1),
      ID(2),
      ID(3),
      ID(4),
    ]);
  });

  it('is deterministic for names with diacritics and mixed case', () => {
    const names = ['Škoda Fabia', 'skoda fabia', 'Zastava', 'Ăstra', 'Audi'];
    const cars = names.map((name, i) => itpIn(9, { id: ID(i + 1), name }));
    const a = dueItems(cars, TODAY);
    expect(dueItems([...cars].reverse(), TODAY)).toEqual(a);
    expect(a.items).toHaveLength(5);
  });

  it('keeps the car name verbatim', () => {
    const name = 'Dacia "Logan" <MCV> 🚗';
    expect(dueItems([car({ name })], TODAY).items[0].carName).toBe(name);
  });
});

describe('the input is left alone', () => {
  it('does not reorder or change the cars it is given', () => {
    const cars = [
      itpIn(50, { id: ID(1), name: 'B' }),
      itpIn(-5, { id: ID(2), name: 'A', nextServiceKm: 150_000 }),
    ];
    const copy = structuredClone(cars);
    dueItems(cars, TODAY);
    expect(cars).toEqual(copy);
  });

  it('does not keep state between calls with different days', () => {
    const c = [car({ itpUntil: '2026-10-20' })];
    const first = dueItems(c, '2026-10-08').items[0].daysLeft;
    const second = dueItems(c, '2026-10-19').items[0].daysLeft;
    expect([first, second]).toEqual([12, 1]);
  });
});

describe('many cars', () => {
  it('orders ten thousand cars into twenty thousand rows with one count each', () => {
    const cars = Array.from({ length: 10_000 }, (_, i) =>
      car({
        id: ID(i + 1),
        itpUntil: addDays(TODAY, (i % 200) - 100),
        name: `Car ${String(i % 97).padStart(3, '0')}`,
        nextServiceKm: 148_200 + ((i % 50) - 10) * 100,
      }),
    );
    const out = dueItems(cars, TODAY);
    expect(out.items).toHaveLength(20_000);
    expect(out.carCount).toBe(10_000);
    const lamps = out.items.filter(
      (i) => i.state === 'red' || i.state === 'amber',
    ).length;
    expect(out.dueSoonCount).toBe(lamps);
    const passedDates = out.items.filter(
      (i) => i.passed && i.daysLeft !== null,
    );
    const firstNonPassed = out.items.findIndex(
      (i) => !(i.passed && i.daysLeft !== null),
    );
    expect(firstNonPassed).toBe(passedDates.length);
  });

  it('answers twenty cars with two rows each as forty rows', () => {
    const cars = Array.from({ length: 20 }, (_, i) =>
      itpIn(100 + i, { id: ID(i + 1), nextServiceKm: 160_000 }),
    );
    expect(dueItems(cars, TODAY).items).toHaveLength(40);
  });
});
