import { createHmac, timingSafeEqual } from 'node:crypto';

import { ROLES, type Role } from './capabilities';

export interface AccessClaims {
  accountId: string;
  role: Role;
}

const HEADER = Buffer.from(
  JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
).toString('base64url');

const sign = (data: string, secret: string) =>
  createHmac('sha256', secret).update(data).digest('base64url');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signAccessToken(
  { accountId, role }: AccessClaims,
  secret: string,
  now = Date.now(),
  minutes = 15,
): string {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({ exp: iat + minutes * 60, iat, role, sub: accountId }),
  ).toString('base64url');
  const data = `${HEADER}.${payload}`;
  return `${data}.${sign(data, secret)}`;
}

// Only tokens this module signed are accepted: the header must be exactly ours,
// so no other algorithm (or "none") can be smuggled in.
export function verifyAccessToken(
  token: string,
  secret: string,
  now = Date.now(),
): AccessClaims | null {
  if (typeof token !== 'string') return null;
  const [header, payload, signature, ...rest] = token.split('.');
  if (header !== HEADER || !payload || !signature || rest.length > 0) {
    return null;
  }
  // Compared as text: decoding would accept padded or re-encoded variants.
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let claims: { exp?: unknown; role?: unknown; sub?: unknown } | null;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (
    typeof claims !== 'object' ||
    claims === null ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 <= now ||
    typeof claims.sub !== 'string' ||
    !UUID.test(claims.sub) ||
    !ROLES.includes(claims.role as Role)
  ) {
    return null;
  }
  return { accountId: claims.sub, role: claims.role as Role };
}
