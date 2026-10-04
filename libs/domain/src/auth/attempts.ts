import { createHash } from 'node:crypto';
import { isIPv6 } from 'node:net';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

const WINDOW_SECONDS = 15 * 60;
const LIMIT = { address: 20, email: 5 } as const;
const SIGN_UP_WINDOW_SECONDS = 60 * 60;
const SIGN_UP_LIMIT = 10;

type Kind = keyof typeof LIMIT;

// One client however its address is written: an IPv4 address also in its
// IPv6-mapped form, and an IPv6 address by its /64, which one subscriber
// usually holds whole.
export function clientOf(address: string): string {
  if (!isIPv6(address)) return address;
  // A zone id names the local interface, not the client.
  const bare = address.split('%')[0] ?? '';
  const groups = expand(new URL(`http://[${bare}]`).hostname.slice(1, -1));
  const [, , , , , mark, high = 0, low = 0] = groups;
  if (groups.slice(0, 5).every((x) => x === 0) && mark === 0xffff) {
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`;
}

// The eight groups of a canonical IPv6 address (no embedded IPv4).
function expand(canonical: string): number[] {
  const [head = '', tail] = canonical.split('::');
  const part = (s: string) =>
    s ? s.split(':').map((x) => parseInt(x, 16)) : [];
  const left = part(head);
  const right = tail === undefined ? [] : part(tail);
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

// The keys never hold the e-mail or the address itself.
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const keyOf = (kind: Kind, value: string) =>
  `auth:fail:${kind}:${digest(kind === 'address' ? clientOf(value) : value)}`;

// Failed sign-ins per e-mail and per address, and sign-ups per address. Redis
// only counts: when it is unreachable the limits are skipped rather than
// sign-in or sign-up being refused.
export class Attempts {
  private readonly logger = new Logger('Auth');

  constructor(private readonly redis: Redis) {}

  async blocked(email: string, address: string): Promise<boolean> {
    try {
      const [byEmail, byAddress] = await this.redis.mget(
        keyOf('email', email),
        keyOf('address', address),
      );
      return (
        Number(byEmail) >= LIMIT.email || Number(byAddress) >= LIMIT.address
      );
    } catch {
      this.unavailable('sign-in');
      return false;
    }
  }

  async fail(email: string, address: string): Promise<void> {
    try {
      await this.redis
        .multi()
        .incr(keyOf('email', email))
        .expire(keyOf('email', email), WINDOW_SECONDS)
        .incr(keyOf('address', address))
        .expire(keyOf('address', address), WINDOW_SECONDS)
        .exec();
    } catch {
      this.unavailable('sign-in');
    }
  }

  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(keyOf('email', email));
    } catch {
      this.unavailable('sign-in');
    }
  }

  // Counts one sign-up from the address; false once it has had its 10 in the
  // hour that began with its first.
  async admitSignUp(address: string): Promise<boolean> {
    try {
      const key = `auth:signup:address:${digest(clientOf(address))}`;
      const replies = await this.redis
        .multi()
        .incr(key)
        .expire(key, SIGN_UP_WINDOW_SECONDS, 'NX')
        .exec();
      // A refused EXPIRE would leave the key counting for ever.
      for (const [error] of replies ?? []) if (error) throw error;
      return Number(replies?.[0]?.[1]) <= SIGN_UP_LIMIT;
    } catch {
      this.unavailable('sign-up');
      return true;
    }
  }

  private unavailable(what: 'sign-in' | 'sign-up') {
    this.logger.warn(`${what} attempt limits skipped: Redis unavailable`);
  }
}
