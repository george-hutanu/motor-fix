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

// @traces 022-review-drawer-FR-015 022-review-drawer-FR-017 022-review-drawer-FR-018
describe('PublishReviewDto', () => {
  it('accepts a job and a rating alone', () => {
    expect(problems(publish())).toEqual([]);
  });

  it('accepts a comment and an amount', () => {
    const dto = publish({ paidBani: 420_050, text: '  Gata la timp.  ' });
    expect(problems(dto)).toEqual([]);
    expect(dto).toMatchObject({ paidBani: 420_050, text: 'Gata la timp.' });
  });

  it('drops a blank comment', () => {
    const dto = publish({ text: '   ' });
    expect(problems(dto)).toEqual([]);
    expect(dto.text).toBeUndefined();
  });

  it.each([
    ['jobId', 'not-a-uuid'],
    ['rating', 4.5],
    ['rating', '4'],
    ['paidBani', 4200.5],
    ['paidBani', '420000'],
    ['text', 42],
  ])('refuses %s %p', (field, value) => {
    expect(problems(publish({ [field]: value }))).toEqual([field]);
  });

  it.each([
    ['car', { brand: 'BMW' }],
    ['jobs', ['Schimb ulei']],
  ])('refuses a %s member', (field, value) => {
    expect(problems(publish({ [field]: value }))).toEqual([field]);
  });

  it('leaves the bounds to the service', () => {
    expect(
      problems(publish({ paidBani: 0, rating: 9, text: 'x'.repeat(2001) })),
    ).toEqual([]);
  });
});
