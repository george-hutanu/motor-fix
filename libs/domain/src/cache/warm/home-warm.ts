import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
} from '@nestjs/common';

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
export class HomeWarm implements HomeWarmer, BeforeApplicationShutdown {
  private readonly logger = new Logger('CacheWarm');
  private readonly running = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly cache: CacheService,
    private readonly accounts: AccountLoader,
    private readonly cars: CarsService,
    private readonly requests: RequestsService,
    private readonly garageRequests: GarageRequestsService,
  ) {}

  homes(accountId: string, role: Role): Promise<void> {
    if (this.closed) return Promise.resolve();
    const warming = this.warm(accountId, role);
    this.running.add(warming);
    warming.then(() => this.running.delete(warming));
    return warming;
  }

  // Nest runs this before it closes the HTTP server and the stores: a warm
  // still reading then would reopen the database pool once it was closed.
  // A sign-in answered meanwhile warms nothing. The wait has no cap of its
  // own: Redis calls give up after the store's command timeout, and a
  // database read that never answers is ended by the platform's stop deadline.
  async beforeApplicationShutdown(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.running]);
  }

  private async warm(accountId: string, role: Role): Promise<void> {
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
