import { createHmac } from 'node:crypto';

import {
  CODE_ATTEMPTS,
  CODE_TTL_MS,
  checkCode,
  codeHash,
  newCode,
} from './phone-sign-in';

const secret = 'test-secret';
const sentAt = new Date('2026-10-06T09:00:00Z');
const row = (overrides: Partial<Parameters<typeof checkCode>[0]> = {}) => ({
  attempts: 0,
  codeHash: codeHash('012345', secret),
  expiresAt: new Date(sentAt.getTime() + CODE_TTL_MS),
  usedAt: null,
  ...overrides,
});
const ahead = (ms: number) => new Date(sentAt.getTime() + CODE_TTL_MS - ms);

describe('sign-in codes', () => {
  it('are six digits, a leading zero included', () => {
    const codes = Array.from({ length: 1000 }, newCode);

    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(990);
  });

  it('are kept only as an HMAC-SHA256 keyed with the token secret', () => {
    const hash = codeHash('012345', secret);

    expect(hash).toBe(
      createHmac('sha256', secret).update('012345').digest('base64url'),
    );
    expect(hash).not.toContain('012345');
    expect(codeHash('012345', 'another-secret')).not.toBe(hash);
  });

  it('last five minutes and take five wrong attempts', () => {
    expect(CODE_TTL_MS).toBe(5 * 60_000);
    expect(CODE_ATTEMPTS).toBe(5);
  });
});

describe('checking a code', () => {
  it('takes the right code while it is live', () => {
    expect(checkCode(row(), '012345', secret, ahead(1))).toBe('right');
  });

  it('finds no code for a number that was sent none', () => {
    expect(checkCode(null, '012345', secret, ahead(1))).toBe('code_invalid');
  });

  it('refuses a code that took its five wrong attempts, without checking it', () => {
    expect(checkCode(row({ attempts: 5 }), '012345', secret, ahead(1))).toBe(
      'too_many_attempts',
    );
  });

  it('checks the attempts before the use and the expiry', () => {
    expect(
      checkCode(
        row({ attempts: 5, usedAt: sentAt }),
        '012345',
        secret,
        ahead(-1),
      ),
    ).toBe('too_many_attempts');
  });

  it('refuses a used code, even before it expires', () => {
    expect(checkCode(row({ usedAt: sentAt }), '012345', secret, ahead(1))).toBe(
      'code_invalid',
    );
  });

  it('checks the use before the expiry', () => {
    expect(checkCode(row({ usedAt: sentAt }), '012345', secret, ahead(0))).toBe(
      'code_invalid',
    );
  });

  it('refuses a right or a wrong code once five minutes have passed', () => {
    expect(checkCode(row(), '012345', secret, ahead(0))).toBe('code_expired');
    expect(checkCode(row(), '999999', secret, ahead(-1))).toBe('code_expired');
  });

  it('counts a wrong code as a wrong attempt', () => {
    expect(checkCode(row({ attempts: 4 }), '012346', secret, ahead(1))).toBe(
      'wrong',
    );
  });
});
