import {
  type AccountRole,
  type AccountState,
  type AdminAccountDto,
  type AdminAccountsPageDto,
  type AdminAccountsSummaryDto,
  isAccountState,
  readRoles,
  rewritePhone,
  SEARCH_MAX,
  SEARCH_MIN,
  settleSearch,
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
import {
  Prisma,
  type PrismaClient,
  type Role,
} from '../../generated/prisma/client';
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

const invalidQuery = () =>
  new BadRequestException({
    code: 'invalid_query',
    message: `The search is longer than ${SEARCH_MAX} characters.`,
  });

const invalidFilter = () =>
  new BadRequestException({
    code: 'invalid_filter',
    message: 'A role or state is not one this list knows, or a state repeats.',
  });

// The query as the address gives it: absent, once, or repeated.
export type Search = {
  q?: string;
  role?: string | string[];
  status?: string | string[];
};

type Filters = {
  q: string | undefined;
  roles: AccountRole[];
  status: AccountState | undefined;
};

const values = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function readSearch(search: Search): Filters {
  const settled = settleSearch(values(search.q).join(' '));
  if (settled.length > SEARCH_MAX) throw invalidQuery();
  const { roles, unknown } = readRoles(values(search.role));
  const states = values(search.status);
  if (unknown.length > 0 || states.length > 1) throw invalidFilter();
  if (states.length === 1 && !isAccountState(states[0])) throw invalidFilter();
  return {
    q: settled.length >= SEARCH_MIN ? settled : undefined,
    roles,
    status: states[0] as AccountState | undefined,
  };
}

// The digits a phone-looking query is matched by: 4 to 15 digits once the
// separators and a leading + or 00 are gone, rewritten as sign-in rewrites a
// number but with no length check ("0722" is +40722).
function phoneDigits(q: string) {
  const bare = q.replace(/[\s.()-]/g, '').replace(/^(\+|00)/, '');
  if (!/^\d{4,15}$/.test(bare)) return undefined;
  return rewritePhone(q).replace(/^\+/, '');
}

// The query as literal text inside a LIKE pattern.
const contained = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

function where(filters: Filters, after?: { createdAt: Date; id: string }) {
  const parts: Prisma.Sql[] = [Prisma.sql`a.status IN ('active', 'suspended')`];
  if (filters.status) {
    parts.push(Prisma.sql`a.status = ${filters.status}::account_status`);
  }
  if (filters.roles.length > 0) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM account_role r WHERE r.account_id = a.id AND r.role::text IN (${Prisma.join(filters.roles)}))`,
    );
  }
  if (filters.q) {
    const like = contained(filters.q);
    const digits = phoneDigits(filters.q);
    parts.push(Prisma.sql`(
      account_fold(a.name) LIKE account_fold(${like})
      OR a.email ILIKE ${like}
      OR EXISTS (SELECT 1 FROM garage_member m JOIN garage g ON g.id = m.garage_id
        WHERE m.account_id = a.id AND account_fold(g.name) LIKE account_fold(${like}))
      OR EXISTS (SELECT 1 FROM mechanic c JOIN garage g ON g.id = c.garage_id
        WHERE c.account_id = a.id AND account_fold(g.name) LIKE account_fold(${like}))
      ${digits ? Prisma.sql`OR a.phone LIKE ${`%${digits}%`}` : Prisma.empty}
    )`);
  }
  if (after) {
    parts.push(
      Prisma.sql`(a.created_at, a.id) < (${after.createdAt}, ${after.id}::uuid)`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

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
    search: Search = {},
  ): Promise<AdminAccountsPageDto> {
    const after = cursor === undefined ? undefined : decode(cursor);
    const filters = readSearch(search);
    if (filters.q || filters.roles.length > 0 || filters.status) {
      return this.found(filters, after, now);
    }
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
    return this.answer(rows, now);
  }

  // A page of the accounts a search and filters match, with their number.
  // The ids come from SQL in the list's order; ST-1's select reads the rows.
  private async found(
    filters: Filters,
    after: { createdAt: Date; id: string } | undefined,
    now: Date,
  ): Promise<AdminAccountsPageDto> {
    // An open watch is ST-4's; until it exists no account is under one.
    if (filters.status === 'watch') {
      return { items: [], nextCursor: null, total: 0 };
    }
    const [ids, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM account a WHERE ${where(filters, after)}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE + 1}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM account a WHERE ${where(filters)}`,
    ]);
    const order = ids.map((r) => r.id);
    const rows = await this.prisma.account.findMany({
      select: ROW,
      where: { id: { in: order } },
    });
    rows.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
    return { ...(await this.answer(rows, now)), total };
  }

  private async answer(rows: Row[], now: Date) {
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
