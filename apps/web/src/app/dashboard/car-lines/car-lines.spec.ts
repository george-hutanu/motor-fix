import type { CarDto } from '@motor-fix/data-access';

import { carLines, compareCars, dueDateStatus, oilStatus } from './car-lines';

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

const kinds = (over: Partial<CarDto>) =>
  carLines(car(over), NOW).map((line) => line.kind);

// @traces 029-FR-003
describe('the oil-service estimate', () => {
  it.each([
    [3800, 'green', 116],
    [1988, 'green', 61],
    [1987, 'amber', 60],
    [247, 'amber', 8],
    [246, 'red', 7],
    [0, 'red', 0],
    [-200, 'red', -6],
  ])(
    'reads %i km left as %s, %i days ahead at 1,000 km a month',
    (kmLeft, state, days) => {
      expect(oilStatus(148200 + kmLeft, 148200)).toEqual({
        days,
        kmLeft,
        state,
      });
    },
  );
});

describe('the date lines’ status', () => {
  it.each([
    ['2026-11-13', 'amber', 36],
    ['2026-12-08', 'green', 61],
    ['2026-10-15', 'red', 7],
    ['2026-10-01', 'red', -7],
  ])('reads %s as %s, %i days ahead', (expiry, state, days) => {
    expect(dueDateStatus(expiry, NOW)).toMatchObject({ days, state });
  });

  it('reads no date as grey', () => {
    expect(dueDateStatus(null, NOW)).toEqual({
      days: null,
      passed: false,
      state: 'grey',
    });
  });
});

// @traces 029-FR-002 029-FR-004
describe('a car’s lines, most urgent first', () => {
  it('ranks the BMW’s amber ITP before its green oil service', () => {
    expect(
      carLines(car({ itpUntil: '2026-11-13', nextServiceKm: 152000 }), NOW),
    ).toMatchObject([
      { days: 36, kind: 'itp', state: 'amber' },
      { days: 116, kind: 'oil', state: 'green' },
      { kind: 'rca', state: 'grey' },
      { kind: 'rovinieta', state: 'grey' },
    ]);
  });

  it('ranks red before amber before green, whatever the kind', () => {
    expect(
      kinds({
        itpUntil: '2027-06-30',
        nextServiceKm: 148300,
        rcaUntil: '2026-11-20',
        rovinietaUntil: '2027-03-01',
      }),
    ).toEqual(['oil', 'rca', 'rovinieta', 'itp']);
  });

  it('ranks a passed line before one still ahead in the same state', () => {
    expect(
      kinds({ itpUntil: '2026-10-12', rcaUntil: '2026-09-30' }).slice(0, 2),
    ).toEqual(['rca', 'itp']);
  });

  it('ranks fewer days first within a state, across dates and the oil estimate', () => {
    expect(
      kinds({
        itpUntil: '2026-12-01',
        nextServiceKm: 148200 + 700,
        rcaUntil: '2026-11-01',
      }).slice(0, 3),
    ).toEqual(['oil', 'rca', 'itp']);
  });

  it('puts a date before the oil service on a tie', () => {
    expect(
      kinds({ itpUntil: '2026-10-29', nextServiceKm: 148200 + 690 }).slice(
        0,
        2,
      ),
    ).toEqual(['itp', 'oil']);
  });

  it('keeps ITP, RCA, rovinietă for equal dates and for missing ones, last', () => {
    expect(
      kinds({ rcaUntil: '2026-11-13', rovinietaUntil: '2026-11-13' }),
    ).toEqual(['rca', 'rovinieta', 'itp']);
    expect(kinds({})).toEqual(['itp', 'rca', 'rovinieta']);
  });

  it('has no oil line without a next-service value', () => {
    expect(kinds({ itpUntil: '2026-11-13' })).not.toContain('oil');
  });
});

// @traces 029-FR-005
describe('cars by their most urgent line', () => {
  const order = (cars: CarDto[]) =>
    [...cars].sort((a, b) => compareCars(a, b, NOW)).map((c) => c.id);

  it('puts the car with the more urgent first line first', () => {
    expect(
      order([
        car({ id: 'green', itpUntil: '2027-06-30' }),
        car({ id: 'red', rcaUntil: '2026-10-10' }),
        car({ id: 'amber', nextServiceKm: 148200 + 1500 }),
      ]),
    ).toEqual(['red', 'amber', 'green']);
  });

  it('puts a passed line first and a car with no date last', () => {
    expect(
      order([
        car({ id: 'none' }),
        car({ id: 'soon', itpUntil: '2026-10-10' }),
        car({ id: 'passed', itpUntil: '2026-09-01' }),
      ]),
    ).toEqual(['passed', 'soon', 'none']);
  });

  it('breaks a tie on state and days by the kind of the first line', () => {
    expect(
      order([
        car({ id: 'rca', rcaUntil: '2026-11-13' }),
        car({ id: 'oil', nextServiceKm: 148200 + 1183 }),
        car({ id: 'itp', itpUntil: '2026-11-13' }),
      ]),
    ).toEqual(['itp', 'rca', 'oil']);
  });

  it('calls two cars with the same first line a tie, so the newer one stays first', () => {
    expect(
      compareCars(
        car({ id: 'a', itpUntil: '2026-11-13' }),
        car({ id: 'b', itpUntil: '2026-11-13' }),
        NOW,
      ),
    ).toBe(0);
    expect(
      order([
        car({ id: 'newer', itpUntil: '2026-11-13' }),
        car({ id: 'older', itpUntil: '2026-11-13' }),
      ]),
    ).toEqual(['newer', 'older']);
  });
});
