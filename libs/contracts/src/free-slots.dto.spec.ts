import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { FreeSlotsQueryDto } from './free-slots.dto';

const JOB = '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c';
const OTHER_JOB = '9f1c2a7b-0000-4000-8000-000000000001';

// Every value arrives as the query string's text, as the global pipe gets it.
const query = (over: Record<string, unknown> = {}) =>
  plainToInstance(FreeSlotsQueryDto, { duration: '120', ...over });
const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

// @traces 154-FR-001
// @traces 154-FR-003
describe('FreeSlotsQueryDto', () => {
  it('takes a duration alone and fills in the count and the horizon', () => {
    const dto = query();

    expect(problems(dto)).toEqual([]);
    expect(dto.duration).toBe(120);
    expect(dto.count).toBe(3);
    expect(dto.horizonDays).toBe(30);
  });

  it('accepts every parameter at once, read as numbers and booleans', () => {
    const dto = query({
      count: '10',
      earliest: '2026-11-10T13:40:00+02:00',
      excludeBookingId: OTHER_JOB,
      horizonDays: '14',
      jobTypeIds: [JOB, OTHER_JOB],
      mechanicId: JOB,
      needsLift: 'true',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.count).toBe(10);
    expect(dto.horizonDays).toBe(14);
    expect(dto.needsLift).toBe(true);
    expect(dto.jobTypeIds).toEqual([JOB, OTHER_JOB]);
  });

  it('reads needsLift=false as false, not as a present string', () => {
    expect(query({ needsLift: 'false' }).needsLift).toBe(false);
  });

  it('accepts a single job type as a list of one', () => {
    const dto = query({ jobTypeIds: JOB });

    expect(problems(dto)).toEqual([]);
    expect(dto.jobTypeIds).toEqual([JOB]);
  });

  it.each([
    ['15', 15],
    ['2400', 2400],
  ])('accepts a duration of %s minutes', (duration, minutes) => {
    const dto = query({ duration });

    expect(problems(dto)).toEqual([]);
    expect(dto.duration).toBe(minutes);
  });

  it.each(['14', '2401', '10', '60.5', 'two hours', ''])(
    'refuses a duration of %p',
    (duration) => {
      expect(problems(query({ duration }))).toEqual(['duration']);
    },
  );

  it('wants a duration', () => {
    expect(problems(plainToInstance(FreeSlotsQueryDto, {}))).toEqual([
      'duration',
    ]);
  });

  it.each(['1', '10'])('accepts a count of %s', (count) => {
    expect(problems(query({ count }))).toEqual([]);
  });

  it.each(['0', '11', '2.5'])('refuses a count of %s', (count) => {
    expect(problems(query({ count }))).toEqual(['count']);
  });

  it.each(['1', '30'])('accepts a horizon of %s days', (horizonDays) => {
    expect(problems(query({ horizonDays }))).toEqual([]);
  });

  it.each(['0', '31'])('refuses a horizon of %s days', (horizonDays) => {
    expect(problems(query({ horizonDays }))).toEqual(['horizonDays']);
  });

  it('accepts an earliest start in the past, which the server clamps', () => {
    expect(problems(query({ earliest: '2020-01-01T08:00:00Z' }))).toEqual([]);
  });

  it.each([
    'tomorrow',
    '2026-11-10',
    '2026-11-10T13:40:00',
    '2026-11-10 13:40+02:00',
  ])('refuses the earliest start %p', (earliest) => {
    expect(problems(query({ earliest }))).toEqual(['earliest']);
  });

  it.each([
    ['jobTypeIds', { jobTypeIds: [JOB, 'oil-change'] }],
    ['mechanicId', { mechanicId: 'costel' }],
    ['excludeBookingId', { excludeBookingId: '42' }],
    ['needsLift', { needsLift: 'maybe' }],
    ['lift', { lift: '2' }],
  ])('names %s when it is wrong or unknown', (field, over) => {
    expect(problems(query(over))).toEqual([field]);
  });
});
