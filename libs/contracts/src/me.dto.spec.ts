import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { DeleteMeDto } from './me.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
function check(body: object) {
  const dto = plainToInstance(DeleteMeDto, body);
  const failed = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
  return { dto, failed };
}

// @traces 129-FR-002
describe('the confirmation of deleting my account', () => {
  it('takes the confirmation trimmed', () => {
    const { dto, failed } = check({ confirmation: '  andrei@example.com \t' });

    expect(failed).toEqual([]);
    expect(dto.confirmation).toBe('andrei@example.com');
  });

  it.each([
    ['1 character', 'x'],
    ['254 characters', 'a'.repeat(254)],
  ])('takes a confirmation of %s', (_, confirmation) => {
    expect(check({ confirmation }).failed).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['empty', { confirmation: '' }],
    ['blank', { confirmation: '   ' }],
    ['255 characters', { confirmation: 'a'.repeat(255) }],
    ['not text', { confirmation: 42 }],
  ])('refuses a confirmation that is %s', (_, body) => {
    expect(check(body).failed).toEqual(['confirmation']);
  });

  it('refuses a field it does not know', () => {
    expect(check({ confirmation: 'DELETE', reason: 'x' }).failed).toEqual([
      'reason',
    ]);
  });
});
