import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { Logger } from '@nestjs/common';
import type { ChainableCommander, Redis } from 'ioredis';

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
const CONTACT_CHANGE_LIMIT = 5;
const PASSWORD_LIMIT = 5;

type Kind = keyof typeof LIMIT;
type Limited =
  | 'sign-in'
  | 'sign-up'
  | 'reset'
  | 'phone-code'
  | 'contact-change'
  | 'password';

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
const changeKey = (accountId: string) => `auth:change:${digest(accountId)}`;
const passwordKey = (accountId: string) => `auth:password:${digest(accountId)}`;

// A counting transaction's replies. One that answers nothing or refuses a
// command (an EXPIRE refused would leave its key counting for ever) is
// Redis unavailable, and the limit is skipped.
const counted = async (counts: ChainableCommander) => {
  const replies = await counts.exec();
  if (!replies) throw new Error('transaction answered nothing');
  for (const [error] of replies) if (error) throw error;
  return replies;
};

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
      const replies = await counted(
        this.redis.multi().incr(key).expire(key, SIGN_UP_WINDOW_SECONDS, 'NX'),
      );
      return Number(replies[0]?.[1]) <= SIGN_UP_LIMIT;
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
      const replies = await counted(counts);
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
      const replies = await counted(counts);
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
    await this.uncount(phoneHourKey(phone), 'phone-code');
  }

  // Counts one e-mail link or phone code for the account's own contact
  // change; false once it has had its 5 in the hour that began with its first.
  async admitContactChange(accountId: string): Promise<boolean> {
    try {
      const key = changeKey(accountId);
      const replies = await counted(
        this.redis.multi().incr(key).expire(key, HOUR_SECONDS, 'NX'),
      );
      return Number(replies[0]?.[1]) <= CONTACT_CHANGE_LIMIT;
    } catch {
      this.unavailable('contact-change');
      return true;
    }
  }

  // A link or code that never left does not count toward the account's hour.
  async uncountContactChange(accountId: string): Promise<void> {
    await this.uncount(changeKey(accountId), 'contact-change');
  }

  // Wrong current passwords at a password change: 5 refuse the next try
  // until 15 minutes after the last.
  async passwordBlocked(accountId: string): Promise<boolean> {
    try {
      return (
        Number(await this.redis.get(passwordKey(accountId))) >= PASSWORD_LIMIT
      );
    } catch {
      this.unavailable('password');
      return false;
    }
  }

  async passwordFailed(accountId: string): Promise<void> {
    try {
      const key = passwordKey(accountId);
      await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec();
    } catch {
      this.unavailable('password');
    }
  }

  async passwordClear(accountId: string): Promise<void> {
    try {
      await this.redis.del(passwordKey(accountId));
    } catch {
      this.unavailable('password');
    }
  }

  // One off an hourly count. Should the hour have ended meanwhile, the key
  // made at -1 is deleted, or the next hour would admit one more.
  private async uncount(key: string, what: Limited) {
    try {
      const replies = await counted(
        this.redis.multi().decr(key).expire(key, HOUR_SECONDS, 'NX'),
      );
      if (Number(replies[0]?.[1]) < 0) await this.redis.del(key);
    } catch {
      this.unavailable(what);
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
