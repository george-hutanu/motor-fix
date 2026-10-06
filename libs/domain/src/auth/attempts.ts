import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

// The Redis of the attempt limits, which the e-mail confirmation's limit shares.
export const AUTH_REDIS = Symbol('AUTH_REDIS');

const WINDOW_SECONDS = 15 * 60;
const LIMIT = { address: 20, email: 5 } as const;
const SIGN_UP_WINDOW_SECONDS = 60 * 60;
const SIGN_UP_LIMIT = 10;
const RESET_WINDOW_SECONDS = 60 * 60;
const RESET_LIMIT = { address: 10, email: 3 } as const;
const HOUR_SECONDS = 60 * 60;
const PHONE_CODE_LIMIT = { address: 20, hour: 5, minute: 1 } as const;

type Kind = keyof typeof LIMIT;
type Limited = 'sign-in' | 'sign-up' | 'reset' | 'phone-code';

// One client however its address is written: an IPv4 address also in its
// IPv6-mapped form, and an IPv6 address by its /64, which one subscriber
// usually holds whole. Null when the address cannot be read: no one client
// may stand for every such request.
export function clientOf(address: string): string | null {
  // A zone id names the local interface, not the client.
  const bare = address.split('%')[0] ?? '';
  const version = isIP(bare);
  if (version === 4) return bare;
  if (version === 0) return null;
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
  `auth:fail:${kind}:${digest(value)}`;
const phoneHourKey = (phone: string) => `auth:code:hour:${digest(phone)}`;

// Failed sign-ins per e-mail and per address, and sign-ups per address. Redis
// only counts: when it is unreachable the limits are skipped rather than
// sign-in or sign-up being refused.
export class Attempts {
  private readonly logger = new Logger('Auth');

  constructor(private readonly redis: Redis) {}

  async blocked(email: string, address: string): Promise<boolean> {
    const client = this.client('sign-in', address);
    try {
      const [byEmail, byAddress] = await this.redis.mget(
        keyOf('email', email),
        ...(client ? [keyOf('address', client)] : []),
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
    const client = clientOf(address);
    try {
      const counts = this.redis
        .multi()
        .incr(keyOf('email', email))
        .expire(keyOf('email', email), WINDOW_SECONDS);
      if (client) {
        counts
          .incr(keyOf('address', client))
          .expire(keyOf('address', client), WINDOW_SECONDS);
      }
      await counts.exec();
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
    const client = this.client('sign-up', address);
    if (!client) return true;
    try {
      const key = `auth:signup:address:${digest(client)}`;
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

  // Counts one reset request for the e-mail and from the address; false once
  // either has had its share of the hour that began with its first.
  async admitReset(email: string, address: string): Promise<boolean> {
    const client = this.client('reset', address);
    const keys: [string, number][] = [
      [`auth:reset:email:${digest(email)}`, RESET_LIMIT.email],
    ];
    if (client) {
      keys.push([`auth:reset:address:${digest(client)}`, RESET_LIMIT.address]);
    }
    try {
      const counts = this.redis.multi();
      for (const [key] of keys) {
        counts.incr(key).expire(key, RESET_WINDOW_SECONDS, 'NX');
      }
      const replies = (await counts.exec()) ?? [];
      for (const [error] of replies) if (error) throw error;
      return keys.every(([, limit], i) => Number(replies[i * 2]?.[1]) <= limit);
    } catch {
      this.unavailable('reset');
      return true;
    }
  }

  // Counts one code sent to the number and one request from the address;
  // false once the number had a code this minute or five this hour, or the
  // address twenty requests this hour. Each window begins with its first.
  async admitPhoneCode(phone: string, address: string): Promise<boolean> {
    const client = this.client('phone-code', address);
    const keys: [string, number, number][] = [
      [`auth:code:minute:${digest(phone)}`, 60, PHONE_CODE_LIMIT.minute],
      [phoneHourKey(phone), HOUR_SECONDS, PHONE_CODE_LIMIT.hour],
    ];
    if (client) {
      keys.push([
        `auth:code:address:${digest(client)}`,
        HOUR_SECONDS,
        PHONE_CODE_LIMIT.address,
      ]);
    }
    try {
      const counts = this.redis.multi();
      for (const [key, seconds] of keys) {
        counts.incr(key).expire(key, seconds, 'NX');
      }
      const replies = (await counts.exec()) ?? [];
      for (const [error] of replies) if (error) throw error;
      return keys.every(
        ([, , limit], i) => Number(replies[i * 2]?.[1]) <= limit,
      );
    } catch {
      this.unavailable('phone-code');
      return true;
    }
  }

  // A code that was never sent does not count toward the number's hour.
  async uncountPhoneCode(phone: string): Promise<void> {
    try {
      const key = phoneHourKey(phone);
      // Should the hour have ended meanwhile, the key still expires.
      await this.redis.multi().decr(key).expire(key, HOUR_SECONDS, 'NX').exec();
    } catch {
      this.unavailable('phone-code');
    }
  }

  // The client behind an address, or null, logged, when it cannot be read.
  private client(what: Limited, address: string) {
    const client = clientOf(address);
    if (!client) {
      this.logger.warn(`${what} address limit skipped: address unreadable`);
    }
    return client;
  }

  private unavailable(what: Limited) {
    this.logger.warn(`${what} attempt limits skipped: Redis unavailable`);
  }
}
