import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PublicLiveQueryDto } from './public-live.dto';

const GARAGE = '0b6f3c1e-0000-4000-8000-000000000001';
const OTHER = '0b6f3c1e-0000-4000-8000-000000000002';
const MECHANIC = '0b6f3c1e-0000-4000-8000-000000000003';
const BRAND = '9f1c2a7b-0000-4000-8000-000000000000';

function errors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(PublicLiveQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('PublicLiveQueryDto', () => {
  it('takes no parameter at all', () => {
    expect(errors({})).toEqual([]);
  });

  it('takes one garage, one mechanic and one brand together', () => {
    expect(
      errors({ brand: BRAND, garages: GARAGE, mechanics: MECHANIC }),
    ).toEqual([]);
  });

  it('refuses two garages', () => {
    expect(errors({ garages: [GARAGE, OTHER] })).not.toEqual([]);
  });

  it('refuses two mechanics', () => {
    expect(errors({ mechanics: [MECHANIC, OTHER] })).not.toEqual([]);
  });

  it('refuses two brands', () => {
    expect(errors({ brand: [BRAND, OTHER] })).not.toEqual([]);
  });

  it('refuses a garage that is not a uuid', () => {
    expect(errors({ garages: 'service-auto-nord' })).not.toEqual([]);
  });

  it('refuses a brand that is not a uuid', () => {
    expect(errors({ brand: 'dacia' })).not.toEqual([]);
  });

  it('refuses a parameter it does not know', () => {
    expect(errors({ garages: GARAGE, token: 'abc' })).toContain(
      'property token should not exist',
    );
  });
});
