import type { CarDto } from '@motor-fix/data-access';

import { carLines, compareCars, oilStatus } from './car-lines';

const NOW = new Date('2026-10-08T09:00:00+03:00');

const car = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: null,
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2019,
  ...over,
});

// @traces 029-FR-003
describe('the date lamp thresholds at the day boundaries', () => {
  it.each([
    ['2026-10-07', 'red', -1],
    ['2026-10-08', 'red', 0],
    ['2026-10-15', 'red', 7],
    ['2026-10-16', 'amber', 8],
    ['2026-12-07', 'amber', 60],
    ['2026-12-08', 'green', 61],
  ])('reads an ITP date of %s as %s with %i days', (itpUntil, state, days) => {
    const [first] = carLines(car({ itpUntil }), NOW).filter(
      (l) => l.kind === 'itp',
    );
    expect({ days: first.days, state: first.state }).toEqual({ days, state });
  });
});

// @traces 029-FR-003
describe('the oil estimate at its extremes', () => {
  it('reads one kilometre left as red with zero days', () => {
    expect(oilStatus(148201, 148200)).toEqual({
      days: 0,
      kmLeft: 1,
      state: 'red',
    });
  });

  it('reads one kilometre past as red with a negative distance', () => {
    expect(oilStatus(148199, 148200)).toMatchObject({
      kmLeft: -1,
      state: 'red',
    });
  });

  it('keeps a huge distance green', () => {
    expect(oilStatus(2_000_000, 0)).toMatchObject({
      kmLeft: 2_000_000,
      state: 'green',
    });
  });

  it('reads a zero odometer with a zero next service as due now', () => {
    expect(oilStatus(0, 0)).toEqual({ days: 0, kmLeft: 0, state: 'red' });
  });

  it('never returns a negative zero for days', () => {
    expect(Object.is(oilStatus(148199, 148200).days, -0)).toBe(false);
  });
});

// @traces 029-FR-002
describe('which lines a car carries', () => {
  it('gives three grey lines in fixed order for a car with nothing set', () => {
    expect(carLines(car(), NOW).map((l) => [l.kind, l.state])).toEqual([
      ['itp', 'grey'],
      ['rca', 'grey'],
      ['rovinieta', 'grey'],
    ]);
  });

  it('adds an oil line when next service is zero', () => {
    expect(
      carLines(car({ nextServiceKm: 0, odometerKm: 0 }), NOW).map(
        (l) => l.kind,
      ),
    ).toContain('oil');
  });

  it('adds no oil line when the answer omits nextServiceKm', () => {
    const old = { ...car() } as Partial<CarDto>;
    delete old.nextServiceKm;
    expect(carLines(old as CarDto, NOW).map((l) => l.kind)).not.toContain(
      'oil',
    );
  });

  it('returns four lines with every field set', () => {
    expect(
      carLines(
        car({
          itpUntil: '2026-11-13',
          nextServiceKm: 152000,
          rcaUntil: '2026-11-13',
          rovinietaUntil: '2026-11-13',
        }),
        NOW,
      ),
    ).toHaveLength(4);
  });
});

// @traces 029-FR-004
describe('the urgency order of a car lines', () => {
  const order = (over: Partial<CarDto>) =>
    carLines(car(over), NOW).map((l) => l.kind);

  it('puts a date line before the oil line on equal days and state', () => {
    expect(
      order({ itpUntil: '2026-10-15', nextServiceKm: 148430 }).slice(0, 2),
    ).toEqual(['itp', 'oil']);
  });

  it('puts the oil line after the rovinieta line on equal days', () => {
    expect(
      order({ nextServiceKm: 148430, rovinietaUntil: '2026-10-15' }).slice(
        0,
        2,
      ),
    ).toEqual(['rovinieta', 'oil']);
  });

  it('orders equal dates ITP then RCA then rovinieta', () => {
    expect(
      order({
        itpUntil: '2026-10-20',
        rcaUntil: '2026-10-20',
        rovinietaUntil: '2026-10-20',
      }),
    ).toEqual(['itp', 'rca', 'rovinieta']);
  });

  it('ranks a passed date line before an overdue-less red oil line', () => {
    expect(
      order({ nextServiceKm: 148200, rcaUntil: '2026-10-01' }).slice(0, 2),
    ).toEqual(['rca', 'oil']);
  });

  it('ranks an overdue oil line before a line passed yesterday', () => {
    expect(
      order({ itpUntil: '2026-10-07', nextServiceKm: 147000 }).slice(0, 2),
    ).toEqual(['oil', 'itp']);
  });

  it('ranks amber oil after a red date line and before a green one', () => {
    expect(
      order({
        itpUntil: '2026-12-31',
        nextServiceKm: 148500,
        rcaUntil: '2026-10-09',
      }),
    ).toEqual(['rca', 'oil', 'itp', 'rovinieta']);
  });

  it('ranks grey lines last even behind a green oil line', () => {
    expect(order({ nextServiceKm: 160000 })[0]).toBe('oil');
  });

  it('gives the same order when called twice', () => {
    const c = car({ itpUntil: '2026-10-20', nextServiceKm: 148500 });
    expect(carLines(c, NOW)).toEqual(carLines(c, NOW));
  });
});

// @traces 029-FR-005
describe('the car order', () => {
  const sorted = (cars: CarDto[]) =>
    [...cars].sort((a, b) => compareCars(a, b, NOW)).map((c) => c.id);

  it('returns zero for two cars with the same first line', () => {
    expect(
      compareCars(
        car({ itpUntil: '2026-10-20' }),
        car({ id: 'b', itpUntil: '2026-10-20' }),
        NOW,
      ),
    ).toBe(0);
  });

  it('keeps the list order for tied cars', () => {
    const cars = [
      car({ id: 'newer', itpUntil: '2026-10-20' }),
      car({ id: 'older', itpUntil: '2026-10-20' }),
    ];
    expect(sorted(cars)).toEqual(['newer', 'older']);
  });

  it('ranks a car with nothing set after one with a green line', () => {
    expect(
      sorted([car({ id: 'empty' }), car({ id: 'ok', itpUntil: '2027-12-31' })]),
    ).toEqual(['ok', 'empty']);
  });

  it('ranks a passed line above a red line still ahead', () => {
    expect(
      sorted([
        car({ id: 'ahead', itpUntil: '2026-10-09' }),
        car({ id: 'passed', rcaUntil: '2026-09-01' }),
      ]),
    ).toEqual(['passed', 'ahead']);
  });

  it('breaks a state and days tie by kind, ITP before RCA', () => {
    expect(
      sorted([
        car({ id: 'rca', rcaUntil: '2026-10-20' }),
        car({ id: 'itp', itpUntil: '2026-10-20' }),
      ]),
    ).toEqual(['itp', 'rca']);
  });

  it('is antisymmetric', () => {
    const a = car({ itpUntil: '2026-10-20' });
    const b = car({ nextServiceKm: 148300 });
    expect(Math.sign(compareCars(a, b, NOW))).toBe(
      -Math.sign(compareCars(b, a, NOW)),
    );
  });
});
