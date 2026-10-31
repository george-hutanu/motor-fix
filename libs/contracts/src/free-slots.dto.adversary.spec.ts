import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { FreeSlotsQueryDto } from './free-slots.dto';

const JOB = '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c';

const query = (over: Record<string, unknown> = {}) =>
  plainToInstance(FreeSlotsQueryDto, { duration: '120', ...over });
const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

// @traces 154-FR-001
describe('FreeSlotsQueryDto against hostile query strings', () => {
  it.each(['1e2', '0x10', ' 60', '60 ', '+60', '-60', '６０', '60\n', '0060x'])(
    'refuses the duration %p as written',
    (duration) => {
      expect(problems(query({ duration }))).toEqual(['duration']);
    },
  );

  it('refuses a duration repeated as a list', () => {
    expect(problems(query({ duration: ['60', '90'] }))).toEqual(['duration']);
  });

  it.each([null, undefined, true, {}])(
    'refuses a duration of %p',
    (duration) => {
      expect(problems(query({ duration }))).toEqual(['duration']);
    },
  );

  it('refuses a count repeated as a list and a null horizon', () => {
    expect(problems(query({ count: ['1', '2'] }))).toEqual(['count']);
    expect(problems(query({ horizonDays: null }))).toEqual(['horizonDays']);
  });

  it.each(['-1', '1e1', '0x5', '٣'])('refuses the count %p', (count) => {
    expect(problems(query({ count }))).toEqual(['count']);
  });

  it.each(['TRUE', '1', '0', 'yes', '', ' true'])(
    'refuses needsLift %p',
    (needsLift) => {
      expect(problems(query({ needsLift }))).toEqual(['needsLift']);
    },
  );

  it('refuses needsLift repeated as a list', () => {
    expect(problems(query({ needsLift: ['true', 'true'] }))).toEqual([
      'needsLift',
    ]);
  });

  it.each([
    '2026-02-30T10:00:00Z',
    '2026-11-10T25:00:00Z',
    '2026-11-10T10:60:00Z',
    '2026-11-10T10:00:00.1234Z',
    '2026-11-10T10:00:00+0200',
    '2026-11-10T10:00:00+2:00',
    '２０２６-11-10T10:00:00Z',
    '2026-11-10T10:00:00Z\n',
    '',
  ])('refuses the earliest start %p', (earliest) => {
    expect(problems(query({ earliest }))).toEqual(['earliest']);
  });

  it.each([
    '2026-11-10T10:00Z',
    '2026-11-10T10:00:00.5+03:00',
    '2026-11-10T10:00:00-05:00',
  ])('accepts the earliest start %p', (earliest) => {
    expect(problems(query({ earliest }))).toEqual([]);
  });

  it('refuses an earliest start given twice', () => {
    expect(
      problems(query({ earliest: ['2026-11-10T10:00Z', '2026-11-10T11:00Z'] })),
    ).toEqual(['earliest']);
  });

  it('refuses an empty job type and an empty entry in a list', () => {
    expect(problems(query({ jobTypeIds: '' }))).toEqual(['jobTypeIds']);
    expect(problems(query({ jobTypeIds: [JOB, ''] }))).toEqual(['jobTypeIds']);
  });

  it('refuses job types sent as an object', () => {
    expect(problems(query({ jobTypeIds: { 0: JOB } }))).toEqual(['jobTypeIds']);
  });

  it('refuses a uuid with stray text for the mechanic and the booking', () => {
    expect(problems(query({ mechanicId: `${JOB}x` }))).toEqual(['mechanicId']);
    expect(problems(query({ excludeBookingId: ` ${JOB}` }))).toEqual([
      'excludeBookingId',
    ]);
  });

  it('refuses an unknown extra field', () => {
    expect(problems(query({ garageId: JOB }))).toEqual(['garageId']);
  });
});
