import { randomUUID } from 'node:crypto';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ReplaceGarageBrandsDto } from './garage-brands.dto';
import { JOBS_MAX } from './listing-sections';

const issues = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(ReplaceGarageBrandsDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

const bmw = randomUUID();
const withJobs = (jobs: unknown) => ({
  brands: [{ brandId: bmw, jobs, stance: 'works_on' }],
});
const ids = (n: number) => Array.from({ length: n }, () => randomUUID());

describe('the jobs of a stance in the owner write', () => {
  it('reads a missing jobs key and an empty list as different values', () => {
    const missing = plainToInstance(
      ReplaceGarageBrandsDto,
      withJobs(undefined),
    );
    const empty = plainToInstance(ReplaceGarageBrandsDto, withJobs([]));
    expect(issues(withJobs(undefined))).toEqual([]);
    expect(issues(withJobs([]))).toEqual([]);
    expect(missing.brands[0].jobs).toBeUndefined();
    expect(empty.brands[0].jobs).toEqual([]);
  });

  it('accepts exactly 50 job ids and refuses 51', () => {
    expect(JOBS_MAX).toBe(50);
    expect(issues(withJobs(ids(50)))).toEqual([]);
    expect(issues(withJobs(ids(51)))).not.toEqual([]);
  });

  it('refuses a null list', () => {
    expect(issues(withJobs(null))).not.toEqual([]);
  });

  it('refuses the same id twice, also when one is in capitals', () => {
    const id = 'abcdefab-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
    expect(issues(withJobs([id, id]))).not.toEqual([]);
    expect(issues(withJobs([id, id.toUpperCase()]))).not.toEqual([]);
  });

  it.each([
    ['a name', ['Schimb de ulei']],
    ['a number', [7]],
    ['a null', [null]],
    ['a nested list', [[randomUUID()]]],
    ['an empty string', ['']],
    ['an id with a trailing space', [`${randomUUID()} `]],
    ['an object instead of a list', { 0: randomUUID() }],
    ['a string instead of a list', randomUUID()],
  ])('refuses %s', (_, jobs) => {
    expect(issues(withJobs(jobs))).not.toEqual([]);
  });

  it('refuses a key spelt differently from jobs', () => {
    expect(
      issues({
        brands: [{ brandId: bmw, stance: 'works_on', unticked: [] }],
      }),
    ).not.toEqual([]);
  });
});
