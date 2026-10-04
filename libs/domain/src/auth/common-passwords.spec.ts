import { isCommonPassword } from './common-passwords';

describe('the list of common passwords', () => {
  it.each([
    'password',
    '12345678',
    'qwertyuiop',
    'password1',
    'iloveyou',
    'parola123',
    'motorfix',
  ])('holds "%s"', (password) => {
    expect(isCommonPassword(password)).toBe(true);
  });

  it('compares without regard to letter case', () => {
    expect(isCommonPassword('PassWord1')).toBe(true);
    expect(isCommonPassword('PAROLA123')).toBe(true);
  });

  it.each([
    'o-parola-lunga',
    'parola-de-test',
    'Andrei-Marin-1987!',
  ])('does not hold "%s"', (password) => {
    expect(isCommonPassword(password)).toBe(false);
  });

  it('holds only passwords that pass the length rule, so the list is the only reason for a refusal', async () => {
    const { COMMON_PASSWORDS } = await import('./common-passwords');

    for (const password of COMMON_PASSWORDS) {
      expect([...password].length).toBeGreaterThanOrEqual(8);
      expect(password).toBe(password.toLowerCase());
    }
  });
});
