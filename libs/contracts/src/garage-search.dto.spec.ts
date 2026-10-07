import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GarageSearchQueryDto } from './garage-search.dto';

const BRAND = '9f1c2a7b-0000-4000-8000-000000000000';

function errors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(GarageSearchQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('GarageSearchQueryDto', () => {
  it('takes a brand id alone', () => {
    expect(errors({ brandId: BRAND })).toEqual([]);
  });

  it('takes a brand id and a cursor of 200 characters', () => {
    expect(errors({ brandId: BRAND, cursor: 'a'.repeat(200) })).toEqual([]);
  });

  it('refuses a search without a brand', () => {
    expect(errors({})).toContain('brandId must be a UUID');
  });

  it('refuses a brand that is not a uuid', () => {
    expect(errors({ brandId: 'dacia' })).toContain('brandId must be a UUID');
  });

  it('refuses a cursor of 201 characters', () => {
    expect(errors({ brandId: BRAND, cursor: 'a'.repeat(201) })).toContain(
      'cursor must be shorter than or equal to 200 characters',
    );
  });

  it('refuses a parameter it does not know', () => {
    expect(errors({ brandId: BRAND, sort: 'rating' })).toContain(
      'property sort should not exist',
    );
  });
});
