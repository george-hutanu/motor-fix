import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CreateTimeBlockDto,
  TimeBlocksQueryDto,
  UpdateTimeBlockDto,
} from './time-blocks.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );
const create = (over: Record<string, unknown>) =>
  plainToInstance(CreateTimeBlockDto, {
    endsAt: '2026-11-12T09:30:00.000Z',
    startsAt: '2026-11-12T08:00:00.000Z',
    ...over,
  });

// @traces 427-FR-003
describe('CreateTimeBlockDto', () => {
  it('accepts a mechanic, a lift, a range and a note', () => {
    expect(
      problems(
        create({
          lift: 2,
          mechanicId: '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c',
          note: 'Client la telefon',
        }),
      ),
    ).toEqual([]);
  });

  it('accepts null for the mechanic, the lift and the note', () => {
    expect(
      problems(create({ lift: null, mechanicId: null, note: null })),
    ).toEqual([]);
  });

  it.each([
    ['mechanicId', { mechanicId: 'mihai' }],
    ['lift', { lift: 0 }],
    ['lift', { lift: 1.5 }],
    ['startsAt', { startsAt: 'tomorrow' }],
    ['endsAt', { endsAt: 12 }],
    ['note', { note: 42 }],
    ['color', { color: 'red' }],
  ])('names %s when it is wrong or unknown', (field, over) => {
    expect(problems(create(over))).toEqual([field]);
  });

  it('wants a start and an end', () => {
    expect(problems(plainToInstance(CreateTimeBlockDto, {}))).toEqual([
      'startsAt',
      'endsAt',
    ]);
  });
});

// @traces 427-FR-003
describe('UpdateTimeBlockDto', () => {
  it('accepts an empty body and any one field', () => {
    expect(problems(plainToInstance(UpdateTimeBlockDto, {}))).toEqual([]);
    expect(
      problems(plainToInstance(UpdateTimeBlockDto, { note: 'Mutat' })),
    ).toEqual([]);
  });

  it('names an unknown field', () => {
    expect(
      problems(plainToInstance(UpdateTimeBlockDto, { garageId: 'x' })),
    ).toEqual(['garageId']);
  });
});

// @traces 427-FR-003
describe('TimeBlocksQueryDto', () => {
  it('accepts Bucharest days, or nothing', () => {
    expect(
      problems(
        plainToInstance(TimeBlocksQueryDto, {
          from: '2026-11-01',
          to: '2026-11-30',
        }),
      ),
    ).toEqual([]);
    expect(problems(plainToInstance(TimeBlocksQueryDto, {}))).toEqual([]);
  });

  it('names a day that is not one', () => {
    expect(
      problems(plainToInstance(TimeBlocksQueryDto, { from: '2026-13-01' })),
    ).toEqual(['from']);
  });
});
