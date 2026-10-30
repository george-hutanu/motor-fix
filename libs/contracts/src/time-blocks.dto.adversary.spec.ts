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
const base = {
  endsAt: '2026-11-12T09:30:00.000Z',
  lift: 1,
  startsAt: '2026-11-12T08:00:00.000Z',
};
const create = (over: Record<string, unknown>) =>
  plainToInstance(CreateTimeBlockDto, { ...base, ...over });
const update = (body: Record<string, unknown>) =>
  plainToInstance(UpdateTimeBlockDto, body);
const query = (body: Record<string, unknown>) =>
  plainToInstance(TimeBlocksQueryDto, body);

// @traces 427-FR-003
describe('CreateTimeBlockDto, pushed', () => {
  it.each([
    ['a fraction', 1.5],
    ['a numeral string', '2'],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an array', [1]],
  ])('names the lift when it is %s', (_title, lift) => {
    expect(problems(create({ lift }))).toEqual(['lift']);
  });

  it.each([
    ['text', 'not-a-uuid'],
    ['an empty string', ''],
    ['a number', 7],
    ['an object', {}],
    ['a uuid with a stray suffix', '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6cx'],
  ])('names the mechanic when it is %s', (_title, mechanicId) => {
    expect(problems(create({ mechanicId }))).toEqual(['mechanicId']);
  });

  it.each([
    ['null', null],
    ['a number', 1_762_934_400_000],
    ['an empty string', ''],
    ['an impossible date', '2026-02-30T08:00:00.000Z'],
    ['a date without a time', '2026-11-12'],
    ['a time with no zone', '2026-11-12T08:00:00'],
    ['text', 'tomorrow morning'],
  ])('names the start when it is %s', (_title, startsAt) => {
    expect(problems(create({ startsAt }))).toEqual(['startsAt']);
  });

  it.each([
    ['null', null],
    ['a date without a time', '2026-11-12'],
    ['a time with no zone', '2026-11-12T09:30:00'],
  ])('names the end when it is %s', (_title, endsAt) => {
    expect(problems(create({ endsAt }))).toEqual(['endsAt']);
  });

  it.each([
    ['a number', 12],
    ['an array', ['a']],
    ['an object', { text: 'a' }],
    ['a boolean', false],
  ])('names the note when it is %s', (_title, note) => {
    expect(problems(create({ note }))).toEqual(['note']);
  });

  it('leaves a note of 201 characters to the service, which trims first', () => {
    expect(problems(create({ note: ` ${'a'.repeat(200)} ` }))).toEqual([]);
    expect(problems(create({ note: 'a'.repeat(201) }))).toEqual([]);
  });

  it('accepts a note of emoji and markup as plain text', () => {
    expect(
      problems(create({ note: '<script>alert(1)</script> 🔧🚗 ăîșț' })),
    ).toEqual([]);
  });

  it.each(['garageId', 'id', 'createdBy', 'updatedBy', 'segments', 'mechanic'])(
    'refuses the field %s, which a client may not set',
    (field) => {
      expect(problems(create({ [field]: 'x' }))).toEqual([field]);
    },
  );

  it('refuses a body with every field wrong at once, naming each', () => {
    const names = problems(
      create({
        endsAt: 1,
        lift: 'a',
        mechanicId: 'b',
        note: 3,
        startsAt: 2,
      }),
    );
    expect(names.sort()).toEqual(
      ['endsAt', 'lift', 'mechanicId', 'note', 'startsAt'].sort(),
    );
  });
});

// @traces 427-FR-007
describe('UpdateTimeBlockDto, pushed', () => {
  it.each(['startsAt', 'endsAt'])(
    'refuses %s set to null, since a block always has a range',
    (field) => {
      expect(problems(update({ [field]: null }))).toEqual([field]);
    },
  );

  it.each([
    ['lift', 2.5],
    ['mechanicId', 'nope'],
    ['note', 5],
    ['startsAt', 'soon'],
    ['endsAt', '2026-11-12'],
  ])('names %s when it is %p', (field, value) => {
    expect(problems(update({ [field]: value }))).toEqual([field]);
  });

  it('accepts the three nullable fields set to null', () => {
    expect(
      problems(update({ lift: null, mechanicId: null, note: null })),
    ).toEqual([]);
  });

  it.each(['garageId', 'id', 'updatedBy', 'createdAt'])(
    'refuses the field %s',
    (field) => {
      expect(problems(update({ [field]: 'x' }))).toEqual([field]);
    },
  );
});

// @traces 427-FR-003
describe('TimeBlocksQueryDto, pushed', () => {
  it.each([
    '2026-13-01',
    '2026-02-30',
    '2026-11-12T00:00:00Z',
    '12-11-2026',
    ' 2026-11-12',
    '2026-11-12\n',
    '',
  ])('names a from of %p', (from) => {
    expect(problems(query({ from }))).toEqual(['from']);
  });

  it('names a to that is not a day', () => {
    expect(problems(query({ from: '2026-11-12', to: '2026-11-31' }))).toEqual([
      'to',
    ]);
  });

  it('refuses a field it does not know', () => {
    expect(problems(query({ from: '2026-11-12', limit: '5' }))).toEqual([
      'limit',
    ]);
  });
});
