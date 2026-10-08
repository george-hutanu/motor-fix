import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const CODE_TTL_MS = 5 * 60_000;
export const CODE_ATTEMPTS = 5;

export const newCode = () => String(randomInt(1_000_000)).padStart(6, '0');

export const codeHash = (code: string, secret: string) =>
  createHmac('sha256', secret).update(code).digest('base64url');

export interface StoredCode {
  attempts: number;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export type CodeCheck =
  | 'right'
  | 'wrong'
  | 'code_invalid'
  | 'code_expired'
  | 'too_many_attempts';

export function checkCode(
  row: StoredCode | null,
  code: string,
  secret: string,
  now: Date,
): CodeCheck {
  if (!row) return 'code_invalid';
  if (row.attempts >= CODE_ATTEMPTS) return 'too_many_attempts';
  if (row.usedAt) return 'code_invalid';
  if (now >= row.expiresAt) return 'code_expired';
  const stored = Buffer.from(row.codeHash);
  const given = Buffer.from(codeHash(code, secret));
  return stored.length === given.length && timingSafeEqual(stored, given)
    ? 'right'
    : 'wrong';
}
