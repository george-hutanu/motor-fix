import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CorrectClientRepairDto } from './client-repairs.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const version = '2026-10-11T08:00:00.000Z';
const correction = (over: Record<string, unknown>) =>
  plainToInstance(CorrectClientRepairDto, { version, ...over });

// @traces 409-FR-005
// @traces 409-FR-006
describe('CorrectClientRepairDto', () => {
  it('accepts a version alone: nothing to change', () => {
    expect(problems(correction({}))).toEqual([]);
  });

  it('accepts all four fields, trimming what was done', () => {
    const dto = correction({
      costBani: 45_000,
      doneOn: '2026-10-01',
      odometerKm: 151_000,
      what: '  Schimb ulei și filtre  ',
    });
    expect(problems(dto)).toEqual([]);
    expect(dto.what).toBe('Schimb ulei și filtre');
  });

  it.each([
    ['odometerKm', 0],
    ['odometerKm', 2_000_000],
    ['costBani', 0],
    ['costBani', 92_000_000],
    ['costBani', null],
    ['what', 'x'.repeat(200)],
    ['doneOn', '2024-02-29'],
  ])('accepts %s at its limit (%p)', (field, value) => {
    expect(problems(correction({ [field]: value }))).toEqual([]);
  });

  it('refuses a correction without a version', () => {
    expect(
      problems(plainToInstance(CorrectClientRepairDto, { what: 'Ulei' })),
    ).toEqual(['version']);
  });

  it.each([
    ['version', 'yesterday'],
    ['version', 42],
    ['what', ''],
    ['what', '   '],
    ['what', 'x'.repeat(201)],
    ['what', 'a\u0007b'],
    ['what', 12],
    ['what', null],
    ['doneOn', '2026-02-30'],
    ['doneOn', '0000-01-01'],
    ['doneOn', '01.10.2026'],
    ['doneOn', null],
    ['odometerKm', -1],
    ['odometerKm', 2_000_001],
    ['odometerKm', 1.5],
    ['odometerKm', '151000'],
    ['odometerKm', null],
    ['costBani', -1],
    ['costBani', 92_000_001],
    ['costBani', 10.5],
    ['costBani', '450'],
  ])('refuses %s = %p, naming the field', (field, value) => {
    expect(problems(correction({ [field]: value }))).toEqual([field]);
  });

  it.each([
    'carId',
    'garageId',
    'garageName',
    'source',
    'sharedWithGarage',
    'deletedAt',
  ])('refuses the field %s, which the owner never changes', (field) => {
    expect(problems(correction({ [field]: 'x' }))).toEqual([field]);
  });
});
