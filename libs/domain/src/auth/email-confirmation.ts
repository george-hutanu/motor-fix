import { createHash, randomBytes } from 'node:crypto';

export const LINK_TTL_MS = 72 * 60 * 60 * 1000;

// Asks for a new link: at most this many in each window.
const ASK_LIMIT = { hour: 5, minute: 1 } as const;
export const ASK_WINDOW_SECONDS = { hour: 60 * 60, minute: 60 } as const;

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// 32 random bytes in base64url: 43 characters, no padding.
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { hash: hashToken(token), token };
}

export const confirmLink = (
  webUrl: string,
  language: 'ro' | 'en',
  token: string,
) => `${webUrl}/${language}/confirm-email/${token}`;

export const overLimit = (asked: Record<keyof typeof ASK_LIMIT, number>) =>
  asked.minute >= ASK_LIMIT.minute || asked.hour >= ASK_LIMIT.hour;
