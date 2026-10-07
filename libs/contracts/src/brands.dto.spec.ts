import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { BrandsQueryDto } from './brands.dto';

function errors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(BrandsQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('BrandsQueryDto', () => {
  it('takes no search at all', () => {
    expect(errors({})).toEqual([]);
  });

  it('takes a search of 60 characters and a cursor', () => {
    expect(
      errors({
        cursor: '9f1c2a7b-0000-4000-8000-000000000000',
        q: 'Ș'.repeat(60),
      }),
    ).toEqual([]);
  });

  it('refuses a search of 61 characters', () => {
    expect(errors({ q: 'a'.repeat(61) })).toContain(
      'q must be shorter than or equal to 60 characters',
    );
  });

  it('refuses a cursor that is not a uuid', () => {
    expect(errors({ cursor: 'page-2' })).toContain('cursor must be a UUID');
  });

  it('refuses a parameter it does not know', () => {
    expect(errors({ sort: 'name' })).toContain(
      'property sort should not exist',
    );
  });
});
