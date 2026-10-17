import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Redis } from 'ioredis';

import type { Actor } from '../../auth/policy';
import { countSupportMessage } from '../../metrics/product-counters';
import { AddressThrottle } from '../../rate-limit/address-throttle';

const PER_HOUR = 5;

// Messages per client address and per signed-in account, in the hour that
// began with the first.
export class SupportThrottle {
  readonly address: AddressThrottle;
  readonly account: AddressThrottle;

  constructor(redis: Redis) {
    const rule = { limit: PER_HOUR, windowSeconds: 60 * 60 };
    this.address = new AddressThrottle(redis, {
      ...rule,
      key: 'support:address',
      name: 'SupportThrottle',
    });
    this.account = new AddressThrottle(redis, {
      ...rule,
      key: 'support:account',
      name: 'SupportThrottle',
    });
  }
}

// Counts every call before its body is read, so a flood of bad bodies is
// refused like a flood of good ones.
@Injectable()
export class SupportThrottleGuard implements CanActivate {
  constructor(
    @Inject(SupportThrottle) private readonly throttle: SupportThrottle,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { actor?: Actor }>();
    const [address, account] = await Promise.all([
      this.throttle.address.take(req.ip ?? ''),
      req.actor
        ? this.throttle.account.takeKey(req.actor.accountId)
        : Promise.resolve(null),
    ]);
    const wait = Math.max(address ?? 0, account ?? 0);
    if (wait === 0) return true;
    countSupportMessage('refused_limit');
    throw new HttpException(
      {
        code: 'too_many_messages',
        message: 'Too many messages; try again later',
        retryAfterSeconds: wait,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
