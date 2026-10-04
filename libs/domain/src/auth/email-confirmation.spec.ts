import { createHash } from 'node:crypto';

import {
  confirmLink,
  hashToken,
  isTokenShape,
  LINK_TTL_MS,
  newToken,
  overLimit,
} from './email-confirmation';

describe('confirmation tokens', () => {
  it('are 32 random bytes written in base64url', () => {
    const { token } = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('differ every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newToken().token));
    expect(tokens.size).toBe(50);
  });

  it('are kept only as their SHA-256 hash', () => {
    const { token, hash } = newToken();
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it('expire 72 hours after they are made', () => {
    expect(LINK_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });

  it('accept only the shape a link carries', () => {
    expect(isTokenShape(newToken().token)).toBe(true);
    expect(isTokenShape('')).toBe(false);
    expect(isTokenShape('a'.repeat(42))).toBe(false);
    expect(isTokenShape('a'.repeat(44))).toBe(false);
    expect(isTokenShape(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isTokenShape(`${'a'.repeat(42)}/`)).toBe(false);
  });
});

describe('the confirmation link', () => {
  it('opens the page in the language of the e-mail', () => {
    expect(confirmLink('https://motorfix.test', 'ro', 'abc')).toBe(
      'https://motorfix.test/ro/confirm-email/abc',
    );
    expect(confirmLink('https://motorfix.test', 'en', 'abc')).toBe(
      'https://motorfix.test/en/confirm-email/abc',
    );
  });
});

describe('asking for a new link', () => {
  it('is allowed once a minute', () => {
    expect(overLimit({ hour: 0, minute: 0 })).toBe(false);
    expect(overLimit({ hour: 1, minute: 1 })).toBe(true);
  });

  it('is allowed 5 times an hour', () => {
    expect(overLimit({ hour: 4, minute: 0 })).toBe(false);
    expect(overLimit({ hour: 5, minute: 0 })).toBe(true);
  });
});
