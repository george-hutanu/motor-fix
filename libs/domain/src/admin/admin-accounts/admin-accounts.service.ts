import type {
  AdminAccountDto,
  AdminAccountsPageDto,
  AdminAccountsSummaryDto,
} from '@motor-fix/contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { PRISMA } from '../../auth/prisma';
import type { Prisma, PrismaClient, Role } from '../../generated/prisma/client';
import { countPlatformFigures } from '../../insights/platform-figures';

export const SUMMARY_KEY = 'admin:accounts:summary';
const SUMMARY_SECONDS = 60;
const PAGE = 20;
const DAY = 86_400_000;
const NEW_FOR = 7 * DAY;

// The order the roles are shown in; the first one decides the count and garage.
const ORDER: Role[] = ['driver', 'garage', 'receptionist', 'mechanic', 'admin'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidCursor = () =>
  new BadRequestException({
    code: 'invalid_cursor',
    message: 'The cursor is not one this list gave out.',
  });

const encode = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

function decode(cursor: string) {
  if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw invalidCursor();
  }
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (parts.length !== 2) throw invalidCursor();
  const [at, id] = parts;
  const createdAt = new Date(at);
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.toISOString() !== at ||
    !UUID.test(id)
  ) {
    throw invalidCursor();
  }
  return { createdAt, id };
}

const isSummary = (value: unknown): value is AdminAccountsSummaryDto =>
  typeof value === 'object' &&
  value !== null &&
  ['activeDrivers', 'garagesListed', 'mechanics'].every((key) => {
    const count = (value as Record<string, unknown>)[key];
    return Number.isInteger(count) && (count as number) >= 0;
  });

const ROW = {
  _count: { select: { cars: { where: { removedAt: null } } } },
  createdAt: true,
  id: true,
  mechanic: { select: { garage: { select: { name: true } } } },
  memberships: { select: { garage: { select: { name: true } }, role: true } },
  name: true,
  roles: { select: { role: true } },
  status: true,
} satisfies Prisma.AccountSelect;

type Row = Prisma.AccountGetPayload<{ select: typeof ROW }>;

const member = (row: Row, role: 'owner' | 'receptionist') =>
  row.memberships.find((m) => m.role === role)?.garage.name ?? null;

// Where each role works; the first of the account's roles that has one names it.
const GARAGE_OF: Partial<Record<Role, (row: Row) => string | null>> = {
  garage: (row) => member(row, 'owner'),
  mechanic: (row) => row.mechanic?.garage.name ?? null,
  receptionist: (row) => member(row, 'receptionist'),
};

// What an account a week old or more is counted by, after its first role;
// the others, and every newer account, by their age in days.
// TODO: count requests and reviews once their stories build them; until
// then the value is 0 (FR-003).
const COUNTED_BY: Partial<Record<Role, 'requests' | 'reviews'>> = {
  driver: 'requests',
  garage: 'reviews',
  mechanic: 'reviews',
};

function item(row: Row, now: Date, suspendedAt?: Date): AdminAccountDto {
  const roles = ORDER.filter((role) => row.roles.some((r) => r.role === role));
  const garage = roles.map((role) => GARAGE_OF[role]).find(Boolean);
  const age = Math.max(0, now.getTime() - row.createdAt.getTime());
  const kind = age < NEW_FOR ? undefined : COUNTED_BY[roles[0]];
  const status = row.status === 'suspended' ? 'suspended' : 'active';
  return {
    carsCount: row._count.cars,
    count: kind
      ? { kind, value: 0 }
      : { kind: 'age', value: Math.floor(age / DAY) },
    createdAt: row.createdAt.toISOString(),
    garageName: garage?.(row) ?? null,
    id: row.id,
    name: row.name,
    roles,
    since:
      status === 'active'
        ? row.createdAt.toISOString()
        : (suspendedAt?.toISOString() ?? null),
    status,
  };
}

@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger('AdminAccounts');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  async page(
    cursor: string | undefined,
    now: Date,
  ): Promise<AdminAccountsPageDto> {
    const after = cursor === undefined ? undefined : decode(cursor);
    const rows = await this.prisma.account.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: ROW,
      take: PAGE + 1,
      where: {
        status: { in: ['active', 'suspended'] },
        ...(after && {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }),
      },
    });
    const shown = rows.slice(0, PAGE);
    const suspendedSince = await this.suspendedSince(
      shown.filter((r) => r.status === 'suspended').map((r) => r.id),
    );
    const last = shown.at(-1);
    return {
      items: shown.map((row) => item(row, now, suspendedSince.get(row.id))),
      nextCursor:
        rows.length > PAGE && last ? encode(last.createdAt, last.id) : null,
    };
  }

  async summary(now: Date): Promise<AdminAccountsSummaryDto> {
    const kept = await this.redis.get(SUMMARY_KEY).catch((error: Error) => {
      this.logger.warn(`account totals not read from Redis: ${error.message}`);
      return null;
    });
    if (kept) {
      try {
        const parsed: unknown = JSON.parse(kept);
        if (isSummary(parsed)) return parsed;
      } catch {
        // An unreadable copy is counted again below.
      }
    }
    const [{ activeDrivers, garagesListed }, mechanics] = await Promise.all([
      countPlatformFigures(this.prisma, now),
      this.prisma.mechanic.count({
        where: { accountId: { not: null }, garage: { status: 'approved' } },
      }),
    ]);
    const totals = { activeDrivers, garagesListed, mechanics };
    await this.redis
      .set(SUMMARY_KEY, JSON.stringify(totals), 'EX', SUMMARY_SECONDS)
      .catch((error: Error) =>
        this.logger.warn(`account totals not kept in Redis: ${error.message}`),
      );
    return totals;
  }

  // The latest recorded change to suspended, per account.
  private async suspendedSince(ids: string[]) {
    const since = new Map<string, Date>();
    if (ids.length === 0) return since;
    const entries = await this.prisma.activityLog.findMany({
      orderBy: { at: 'desc' },
      select: { at: true, subjectId: true },
      where: {
        field: 'status',
        newValue: { equals: 'suspended' },
        subjectId: { in: ids },
        subjectType: 'account',
      },
    });
    for (const { at, subjectId } of entries) {
      if (!since.has(subjectId)) since.set(subjectId, at);
    }
    return since;
  }
}
