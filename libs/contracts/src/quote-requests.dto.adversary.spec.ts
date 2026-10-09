import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CandidateGaragesQueryDto,
  CreateQuoteRequestDto,
} from './quote-requests.dto';
import { REQUEST_DESCRIPTION_MAX, REQUEST_MAX_GARAGES } from './request-status';

const CAR = '0f1e2d3c-0000-4000-8000-000000000001';
const J1 = '0f1e2d3c-0000-4000-8000-000000000004';
const garage = (n: number) =>
  `0f1e2d3c-0000-4000-8000-${String(n + 100).padStart(12, '0')}`;
const garages = (n: number) => Array.from({ length: n }, (_, i) => garage(i));

const options = { forbidNonWhitelisted: true, whitelist: true };
const send = (body: Record<string, unknown>) => {
  const dto = plainToInstance(CreateQuoteRequestDto, body);
  return {
    dto,
    failed: validateSync(dto, options).map((e) => e.property),
  };
};
const query = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(CandidateGaragesQueryDto, body), options).map(
    (e) => e.property,
  );

const valid = (over: Record<string, unknown> = {}) => ({
  carId: CAR,
  garageIds: [garage(0)],
  jobTypeIds: [J1],
  sources: ['profile_direct'],
  ...over,
});

describe('CreateQuoteRequestDto under hostile input', () => {
  // The garage count and the one-for-one sources are the service's checks,
  // each with its own error code; the API's integration spec covers them.
  it('takes exactly the maximum number of garages', () => {
    const n = REQUEST_MAX_GARAGES;
    expect(
      send(valid({ garageIds: garages(n), sources: Array(n).fill('search') }))
        .failed,
    ).toEqual([]);
  });

  it('refuses a body with no sources', () => {
    const { sources: _drop, ...rest } = valid();
    expect(send(rest).failed).toContain('sources');
  });

  it.each([
    ['a string', 'search'],
    ['null', null],
    ['an object', { 0: 'search' }],
  ])('refuses sources given as %s', (_, sources) => {
    expect(send(valid({ sources })).failed).toContain('sources');
  });

  it.each([
    ['a string', J1],
    ['null', null],
    ['undefined', undefined],
  ])('refuses job type ids given as %s', (_, jobTypeIds) => {
    expect(send(valid({ jobTypeIds })).failed).toContain('jobTypeIds');
  });

  it('refuses garage ids that differ only by letter case', () => {
    const lower = garage(0);
    expect(
      send(
        valid({
          garageIds: [lower, lower.toUpperCase()],
          sources: ['search', 'search'],
        }),
      ).failed,
    ).toContain('garageIds');
  });

  it('refuses a null element among the garages', () => {
    expect(send(valid({ garageIds: [null] })).failed).toContain('garageIds');
  });

  it('refuses a source in a different letter case', () => {
    expect(send(valid({ sources: ['Search'] })).failed).toContain('sources');
  });

  it('refuses a car id with trailing whitespace', () => {
    expect(send(valid({ carId: `${CAR} ` })).failed).toContain('carId');
  });

  it.each([
    ['a number', 12345],
    ['an array', ['long enough description']],
    ['an object', { a: 1 }],
  ])('refuses a description given as %s', (_, description) => {
    expect(send(valid({ description })).failed).toContain('description');
  });

  it('keeps a whitespace-only description as none', () => {
    expect(send(valid({ description: ' \t\n  ' })).dto.description).toBeNull();
  });

  it('counts the maximum after trimming, so padding does not push it over', () => {
    const description = ` ${'a'.repeat(REQUEST_DESCRIPTION_MAX)} `;
    const { dto, failed } = send(valid({ description }));
    expect(failed).toEqual([]);
    expect(dto.description).toHaveLength(REQUEST_DESCRIPTION_MAX);
  });

  it('counts a two-code-unit emoji as the characters the limit means', () => {
    const description = '😀'.repeat(REQUEST_DESCRIPTION_MAX);
    expect(send(valid({ description })).failed).toEqual([]);
  });

  it('takes a description in Romanian with diacritics', () => {
    expect(
      send(valid({ description: 'Motorul scoate un zgomot ciudat la rece' }))
        .failed,
    ).toEqual([]);
  });

  it('refuses a field a client invents, such as the owner', () => {
    expect(send(valid({ driverId: CAR })).failed).toContain('driverId');
  });
});

describe('CandidateGaragesQueryDto under hostile input', () => {
  it.each([
    ['a third number', '46.7,23.6,1'],
    ['spaces around the comma', '46.7, 23.6'],
    ['letters', 'abc,def'],
    ['empty', ''],
    ['Bucharest swapped to lng,lat', '26.1,44.4'],
    ['the equator', '0,0'],
    ['a scientific number', '4.6e1,2.3e1'],
  ])('refuses near of %s', (_, near) => {
    expect(query({ carId: CAR, near })).toContain('near');
  });

  it('refuses a car with several jobs when one is not an id', () => {
    expect(query({ carId: CAR, jobTypeIds: `${J1},nope` })).toContain(
      'jobTypeIds',
    );
  });

  it('refuses an empty element in the job list', () => {
    expect(query({ carId: CAR, jobTypeIds: `${J1},` })).toContain('jobTypeIds');
  });

  it('refuses an empty job list given as an empty string', () => {
    expect(query({ carId: CAR, jobTypeIds: '' })).toContain('jobTypeIds');
  });

  it('refuses job ids repeated in a different case', () => {
    expect(
      query({ carId: CAR, jobTypeIds: `${J1},${J1.toUpperCase()}` }),
    ).toContain('jobTypeIds');
  });

  it('refuses a car given twice as a list', () => {
    expect(query({ carId: [CAR, CAR] })).toContain('carId');
  });

  it('refuses an unknown query parameter', () => {
    expect(query({ carId: CAR, radius: '500' })).toContain('radius');
  });

  it('refuses an exclude that is not an id', () => {
    expect(query({ carId: CAR, exclude: 'x' })).toContain('exclude');
  });

  it('takes an exclude in upper case and keeps it in lower case', () => {
    const dto = plainToInstance(CandidateGaragesQueryDto, {
      carId: CAR,
      exclude: garage(0).toUpperCase(),
    });
    expect(validateSync(dto, options)).toEqual([]);
    expect(dto.exclude).toBe(garage(0));
  });
});
