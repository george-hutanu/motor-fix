import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { LogRepairDto } from './car-history.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const valid = {
  doneOn: '2026-10-01',
  garageName: 'Service Popescu',
  odometerKm: 148_250,
  what: 'Schimb plăcuțe frână',
};
const repair = (over: Record<string, unknown>) =>
  plainToInstance(LogRepairDto, { ...valid, ...over });

// @traces 062-FR-002
describe('LogRepairDto against hostile text', () => {
  it.each([
    ['what', '🔧'.repeat(121)],
    ['what', '  ab '],
    ['what', 'ab\ud800cd'],
    ['garageName', 'A '],
    ['garageName', '🔧'.repeat(81)],
  ])('refuses %s = %j', (field, value) => {
    expect(problems(repair({ [field]: value }))).toEqual([field]);
  });

  it('refuses a garage name of null beside no garage id', () => {
    expect(problems(repair({ garageName: null }))).toEqual(['garageName']);
  });

  it('refuses a garage id of null beside no garage name', () => {
    const { garageName: _, ...rest } = valid;
    expect(
      problems(plainToInstance(LogRepairDto, { ...rest, garageId: null })),
    ).not.toEqual([]);
  });

  it('refuses a date with a time or a padded date', () => {
    expect(problems(repair({ doneOn: '2026-10-01T00:00:00Z' }))).toEqual([
      'doneOn',
    ]);
    expect(problems(repair({ doneOn: '2026-10-01 ' }))).toEqual(['doneOn']);
  });
});
