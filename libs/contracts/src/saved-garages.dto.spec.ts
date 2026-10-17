import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SaveGarageDto } from './saved-garages.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
function failed(body: object) {
  return validateSync(plainToInstance(SaveGarageDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
}

// @traces 290-FR-002
describe('the body of a save', () => {
  it('takes an empty body', () => {
    expect(failed({})).toEqual([]);
  });

  it.each([
    '2026-10-17T09:30:00.000Z',
    '2026-10-17T09:30:00Z',
    '2026-10-17T12:30:00+03:00',
  ])('takes the time %s', (savedAt) => {
    expect(failed({ savedAt })).toEqual([]);
  });

  it.each(['yesterday', '2026-02-30T10:00:00Z', '17.10.2026', ''])(
    'refuses the time %p',
    (savedAt) => {
      expect(failed({ savedAt })).toEqual(['savedAt']);
    },
  );

  it('refuses a time that is not a string', () => {
    expect(failed({ savedAt: 1_760_000_000_000 })).toEqual(['savedAt']);
  });

  it('refuses an unknown field', () => {
    expect(failed({ garageId: 'g1' })).toEqual(['garageId']);
  });
});
