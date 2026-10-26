// @traces 091-FR-004 091-FR-005 091-FR-017
import { monthlyAverageKm, type Reading, serviceDueOn } from './odometer';

const at = (readOn: string, km: number, createdAt = `${readOn}T09:00:00Z`) =>
  ({ createdAt: new Date(createdAt), km, readOn }) satisfies Reading;

const YEAR = [at('2025-10-08', 131_900), at('2026-10-08', 148_200)];
const TODAY = '2026-10-08';

describe('the average monthly mileage', () => {
  it('is the change between the oldest and newest reading of the last year, per 30.44 days', () => {
    expect(Math.round(monthlyAverageKm(YEAR, TODAY))).toBe(1359);
  });

  it('is 1,000 km with a single reading', () => {
    expect(monthlyAverageKm([at(TODAY, 148_200)], TODAY)).toBe(1000);
  });

  it('is 1,000 km with no reading', () => {
    expect(monthlyAverageKm([], TODAY)).toBe(1000);
  });

  it('is 1,000 km when the readings are under 30 days apart', () => {
    const close = [at('2026-09-09', 146_000), at(TODAY, 148_200)];
    expect(monthlyAverageKm(close, TODAY)).toBe(1000);
  });

  it('counts readings exactly 30 days apart', () => {
    const month = [at('2026-09-08', 147_000), at(TODAY, 148_200)];
    expect(monthlyAverageKm(month, TODAY)).toBeCloseTo((1200 / 30) * 30.44);
  });

  it('counts a reading exactly 12 months old and leaves out one a day older', () => {
    const edge = [at('2025-10-08', 131_900), at(TODAY, 148_200)];
    expect(Math.round(monthlyAverageKm(edge, TODAY))).toBe(1359);
    const older = [
      at('2025-10-07', 100_000),
      at('2026-04-08', 140_000),
      at(TODAY, 148_200),
    ];
    expect(monthlyAverageKm(older, TODAY)).toBeCloseTo((8200 / 183) * 30.44);
  });

  it('is 1,000 km when the odometer was lowered', () => {
    const lowered = [at('2025-11-08', 150_000), at(TODAY, 148_200)];
    expect(monthlyAverageKm(lowered, TODAY)).toBe(1000);
  });

  it('is 1,000 km when the odometer did not move', () => {
    const still = [at('2025-11-08', 148_200), at(TODAY, 148_200)];
    expect(monthlyAverageKm(still, TODAY)).toBe(1000);
  });

  it('does not depend on the order the readings come in', () => {
    expect(monthlyAverageKm([...YEAR].reverse(), TODAY)).toBe(
      monthlyAverageKm(YEAR, TODAY),
    );
  });
});

describe('the estimated day of the next oil service', () => {
  const car = (nextServiceKm: number | null, odometerKm = 148_200) => ({
    nextServiceKm,
    odometerKm,
  });

  it('is 85 days after the newest reading with 3,800 km left at 1,359 km a month', () => {
    expect(serviceDueOn(car(152_000), YEAR, TODAY)).toBe('2027-01-01');
  });

  it('is 34 days away with 1,500 km left', () => {
    expect(serviceDueOn(car(149_700), YEAR, TODAY)).toBe('2026-11-11');
  });

  it('stops at ten years when the average is a kilometre in 300 days', () => {
    const crawl = [at('2026-01-01', 100_000), at('2026-10-28', 100_001)];
    expect(serviceDueOn(car(200_000, 100_001), crawl, '2026-10-28')).toBe(
      '2036-10-25',
    );
  });

  it('is 116 days away at the 1,000 km default', () => {
    expect(serviceDueOn(car(152_000), [at(TODAY, 148_200)], TODAY)).toBe(
      '2027-02-01',
    );
  });

  it('counts from the newest reading, not from today', () => {
    const old = [at('2026-08-01', 148_200)];
    expect(serviceDueOn(car(152_000), old, TODAY)).toBe('2026-11-25');
  });

  it('counts from the newest reading when it is over a year old', () => {
    const old = [at('2025-06-01', 148_200)];
    expect(serviceDueOn(car(152_000), old, TODAY)).toBe('2025-09-25');
  });

  it('counts from today when the car has no reading', () => {
    expect(serviceDueOn(car(152_000), [], TODAY)).toBe('2027-02-01');
  });

  it('is null at 0 km left', () => {
    expect(serviceDueOn(car(148_200), YEAR, TODAY)).toBeNull();
  });

  it('is null past the value', () => {
    expect(serviceDueOn(car(148_000), YEAR, TODAY)).toBeNull();
  });

  it('is null without a value', () => {
    expect(serviceDueOn(car(null), YEAR, TODAY)).toBeNull();
  });

  it("is the newest reading's day with a single kilometre left", () => {
    expect(serviceDueOn(car(148_201), YEAR, TODAY)).toBe(TODAY);
  });
});
