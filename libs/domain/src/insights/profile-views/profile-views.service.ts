import { createHmac, randomBytes } from 'node:crypto';

import {
  PROFILE_VIEW_SOURCES,
  type ProfileViewSource,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { recordView, type ViewOutcome } from './profile-views.metrics';
import { AUTH_REDIS, clientOf } from '../../auth/attempts';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { addDays, atLocal, localDay } from '../../bucharest';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { PrismaClient } from '../../generated/prisma/client';

interface Visitor {
  accountId?: string;
  address: string;
  userAgent: string | undefined;
}

const BOT =
  /bot|crawl|spider|slurp|fetch|headless|lighthouse|curl|wget|python|java\/|preview/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The address as one client: an IPv4 address also in its IPv6-mapped form,
// and an IPv6 address whole, not by the /64 the throttle groups it in, since
// one network may hold many visitors.
function addressOf(address: string): string | null {
  const client = clientOf(address);
  if (!client?.endsWith('/64')) return client;
  return new URL(`http://[${address.split('%')[0]}]`).hostname.slice(1, -1);
}

// A signed-in visitor is their account on every device. Anyone else is the
// address and the agent under the day's secret, so the key cannot be turned
// back into either and changes every day. No agent or no readable address
// gives no key, and the view is not counted.
export function visitorKey(visitor: Visitor, secret: string): string | null {
  if (visitor.accountId) return visitor.accountId;
  const client = addressOf(visitor.address);
  if (!client || !visitor.userAgent) return null;
  return createHmac('sha256', secret)
    .update(`${client}\n${visitor.userAgent}`)
    .digest('hex');
}

export const isBot = (agent: string | undefined) =>
  agent !== undefined && BOT.test(agent);

export const viewSource = (value: unknown): ProfileViewSource =>
  (PROFILE_VIEW_SOURCES as readonly unknown[]).includes(value)
    ? (value as ProfileViewSource)
    : 'profile_direct';

// The Bucharest day's total and source counters, kept until the midnight that
// ends the second day after, so the night can catch up a missed run.
export function counterKeys(
  garageId: string,
  source: ProfileViewSource,
  at: Date,
) {
  const day = localDay(at);
  const total = `insights:pv:${garageId}:${day}`;
  return {
    bySource: `${total}:${source}`,
    expiresAt: atLocal(addDays(day, 3), 0),
    total,
  };
}

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

// Counts distinct visitors per garage and day in Redis; the night writes the
// day's figures from them.
@Injectable()
export class ProfileViewsService {
  private readonly logger = new Logger('ProfileViews');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  async record(
    id: string,
    visitor: Visitor & { actor?: Actor },
    source: unknown,
    now = new Date(),
  ): Promise<void> {
    const garageId = id.toLowerCase();
    const garage = UUID.test(garageId)
      ? await this.prisma.garage.findFirst({
          select: { id: true },
          where: { id: garageId, ...publicGarages() },
        })
      : null;
    if (!garage) {
      recordView('not_found');
      throw notFound();
    }
    const outcome = await this.outcome(garageId, visitor, source, now);
    recordView(outcome);
  }

  private async outcome(
    garageId: string,
    visitor: Visitor & { actor?: Actor },
    source: unknown,
    now: Date,
  ): Promise<ViewOutcome> {
    const { actor } = visitor;
    if (actor && (await this.ownView(garageId, actor))) return 'staff';
    if (isBot(visitor.userAgent)) return 'bot';
    try {
      return await this.count(garageId, visitor, viewSource(source), now);
    } catch (error) {
      // Lost, never refused: the visitor sees nothing of it.
      this.logger.error(
        `view lost: Redis unavailable (${(error as Error | undefined)?.name ?? 'unknown'})`,
      );
      return 'lost';
    }
  }

  private async count(
    garageId: string,
    visitor: Visitor & { actor?: Actor },
    source: ProfileViewSource,
    now: Date,
  ): Promise<ViewOutcome> {
    const keys = counterKeys(garageId, source, now);
    const expiresAt = Math.floor(keys.expiresAt.getTime() / 1000);
    const accountId = visitor.actor?.accountId;
    const secret = accountId ? '' : await this.secret(localDay(now), expiresAt);
    const key = visitorKey({ ...visitor, accountId }, secret);
    if (!key) return 'no_key';
    const replies =
      (await this.redis
        .multi()
        .pfadd(keys.total, key)
        .pfadd(keys.bySource, key)
        .expireat(keys.total, expiresAt, 'NX')
        .expireat(keys.bySource, expiresAt, 'NX')
        .exec()) ?? [];
    for (const [error] of replies) if (error) throw error;
    return 'accepted';
  }

  // The platform's and the garage's own people do not count.
  private async ownView(garageId: string, actor: Actor) {
    if (actor.roles.includes('admin')) return true;
    const where = { accountId: actor.accountId, garageId };
    const [members, mechanics] = await Promise.all([
      this.prisma.garageMember.count({ where }),
      this.prisma.mechanic.count({ where }),
    ]);
    return members + mechanics > 0;
  }

  // One random secret per day, written by whichever view comes first.
  private async secret(day: string, expiresAt: number): Promise<string> {
    const key = `insights:pv:secret:${day}`;
    const replies =
      (await this.redis
        .multi()
        .set(key, randomBytes(32).toString('hex'), 'EXAT', expiresAt, 'NX')
        .get(key)
        .exec()) ?? [];
    for (const [error] of replies) if (error) throw error;
    return String(replies[1]?.[1]);
  }
}
