import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PublishReviewDto } from './reviews.dto';

const jobId = '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c';
const publish = (over: Record<string, unknown> = {}) =>
  plainToInstance(PublishReviewDto, { jobId, rating: 4, ...over });
const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

// @traces 022-FR-015 022-FR-017 022-FR-018
describe('PublishReviewDto on hostile bodies', () => {
  it.each([
    ['rating', 2.5],
    ['rating', '5'],
    ['rating', null],
    ['rating', undefined],
    ['rating', Number.NaN],
    ['rating', Number.POSITIVE_INFINITY],
    ['rating', true],
    ['rating', [4]],
    ['rating', { n: 4 }],
    ['jobId', ''],
    ['jobId', null],
    ['jobId', undefined],
    ['jobId', 42],
    ['jobId', [jobId]],
    ['jobId', `${jobId} `],
    ['paidBani', '4200'],
    ['paidBani', 4200.01],
    ['paidBani', Number.NaN],
    ['paidBani', Number.POSITIVE_INFINITY],
    ['paidBani', true],
    ['paidBani', [100]],
    ['text', 0],
    ['text', false],
    ['text', ['a']],
    ['text', { a: 1 }],
  ])('refuses %s %p', (field, value) => {
    expect(problems(publish({ [field]: value }))).toEqual([field]);
  });

  it.each([
    ['rating', 0],
    ['rating', 6],
    ['rating', -1],
    ['rating', 1e21],
    ['paidBani', 0],
    ['paidBani', -5],
    ['paidBani', 100_000_001],
    ['paidBani', Number.MAX_SAFE_INTEGER],
  ])('leaves the bound of %s %p to the service', (field, value) => {
    expect(problems(publish({ [field]: value }))).toEqual([]);
  });

  it.each([
    ['status', 'published'],
    ['id', jobId],
    ['driverId', jobId],
    ['garageId', jobId],
    ['mechanicId', jobId],
    ['postedAt', '2020-01-01'],
    ['source', 'job'],
    ['car', null],
    ['jobs', []],
  ])('refuses an extra %s member', (field, value) => {
    expect(problems(publish({ [field]: value }))).toEqual([field]);
  });

  it('refuses a body with only unknown members', () => {
    const dto = plainToInstance(PublishReviewDto, { car: 1 });
    expect(problems(dto).sort()).toEqual(['car', 'jobId', 'rating']);
  });

  it('refuses a body that is an empty object', () => {
    const dto = plainToInstance(PublishReviewDto, {});
    expect(problems(dto).sort()).toEqual(['jobId', 'rating']);
  });

  it.each([
    ['  ', undefined],
    ['\t\n\r ', undefined],
    [' 　', undefined],
    ['﻿', undefined],
    ['', undefined],
    [' ok ', 'ok'],
    [' a  b ', 'a  b'],
  ])('reads the comment %p as %p', (text, expected) => {
    const dto = publish({ text });
    expect(problems(dto)).toEqual([]);
    expect(dto.text).toBe(expected);
  });

  it('keeps an absent comment and amount absent', () => {
    const dto = publish();
    expect(dto.text).toBeUndefined();
    expect(dto.paidBani).toBeUndefined();
  });

  it('passes a 10 MB comment to the service without trimming it down', () => {
    const dto = publish({ text: 'é'.repeat(10_000_000) });
    expect(problems(dto)).toEqual([]);
    expect(dto.text).toHaveLength(10_000_000);
  });

  it('accepts an upper-case job id', () => {
    expect(problems(publish({ jobId: jobId.toUpperCase() }))).toEqual([]);
  });

  it('keeps an inherited prototype member out of the whitelist', () => {
    const body = JSON.parse(
      `{"jobId":"${jobId}","rating":4,"__proto__":{"rating":1}}`,
    );
    const dto = plainToInstance(PublishReviewDto, body);
    expect(dto.rating).toBe(4);
    expect(problems(dto)).toEqual([]);
  });
});
