import { Injectable, Logger } from '@nestjs/common';

import { AccountLoader, actorOf } from '../../auth/account-loader';
import type { Role } from '../../auth/capabilities';
import type { Actor } from '../../auth/policy';
import type { HomeWarmer } from '../../auth/sign-in.service';
import { CarsService } from '../../cars/my-cars/cars/cars.service';
import { GarageRequestsService } from '../../quotes/garage-requests/garage-requests.service';
import { RequestsService } from '../../quotes/requests/requests.service';
import type { CacheKind } from '../cache.metrics';
import { CacheService, cacheKey } from '../cache.service';

const SOFT_SECONDS = 90;
const STATUSES = ['waiting', 'quoted', 'closed'] as const;

// What the home reads first, read while the sign-in answer travels back, so
// that read finds it in Redis; the routes take it once.
@Injectable()
export class HomeWarm implements HomeWarmer {
  private readonly logger = new Logger('CacheWarm');

  constructor(
    private readonly cache: CacheService,
    private readonly accounts: AccountLoader,
    private readonly cars: CarsService,
    private readonly requests: RequestsService,
    private readonly garageRequests: GarageRequestsService,
  ) {}

  async homes(accountId: string, role: Role): Promise<void> {
    if ((role !== 'driver' && role !== 'garage') || !this.cache.available) {
      return;
    }
    try {
      const actor = actorOf(await this.accounts.activeAccount(accountId), role);
      await this.cache.warm(() =>
        Promise.all(
          role === 'driver' ? this.driver(actor) : this.garage(actor),
        ),
      );
    } catch (error) {
      this.logger.warn(`cache warm skipped: ${String(error)}`);
    }
  }

  private driver(actor: Actor) {
    const tags = [`warm:account:${actor.accountId}`];
    return [
      this.read('driver-home', [actor.accountId, 'cars'], tags, () =>
        this.cars.list(actor),
      ),
      this.read('driver-home', [actor.accountId, 'requests'], tags, () =>
        this.requests.list(actor),
      ),
    ];
  }

  private garage(actor: Actor) {
    const { garageId } = actor;
    if (!garageId) return [];
    const tags = [`warm:garage:${garageId}`, `warm:account:${actor.accountId}`];
    return STATUSES.map((status) =>
      this.read('garage-home', [garageId, status], tags, () =>
        this.garageRequests.list(actor, { status }),
      ),
    );
  }

  private read(
    kind: CacheKind,
    parts: string[],
    tags: string[],
    list: () => Promise<unknown>,
  ) {
    return this.cache.read({
      key: cacheKey(kind, ...parts),
      read: async () => ({ tags, value: await list() }),
      soft: SOFT_SECONDS,
      stale: false,
    });
  }
}
