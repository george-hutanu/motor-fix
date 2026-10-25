import {
  type AdminBrandDto,
  type AdminBrandListDto,
  type BrandDto,
  type BrandPageDto,
  type CreateBrandDto,
  fold,
  type UpdateBrandDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import { slugOf } from './brands';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { AUTH_REDIS } from '../../auth/attempts';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import {
  type Brand,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client';

const PAGE = 20;
const CACHE_SECONDS = 3600;
const VERSION_KEY = 'brands:version';

// A change bumps the version instead of deleting the cached list, so a search
// that read PostgreSQL before the change writes its list under the old version,
// which no later search reads. A failed bump leaves the old list for its hour.
export async function dropActiveBrands(redis: Redis, logger: Logger) {
  await redis.incr(VERSION_KEY).catch((error: unknown) => {
    logger.warn(`brand cache not dropped: ${String(error)}`);
  });
}

const SLUG_MIN = 2;
const SLUG_MAX = 40;

// The columns an admin edit compares and audits.
const EDITED = ['name', 'slug', 'active'] as const;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such brand');

const taken = (holder: string) =>
  refusal(HttpStatus.CONFLICT, 'brand_exists', `Marca există deja: ${holder}`);

// The slug a name stands for, or 400 when it would not make a usable one.
function slugFor(name: string) {
  const slug = slugOf(name);
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      `name must make a slug of ${SLUG_MIN} to ${SLUG_MAX} letters or digits`,
      [{ code: 'slug', field: 'name' }],
    );
  }
  return slug;
}

const isUniqueClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

type Counted = Brand & { _count: { cars: number; garageBrands: number } };

const COUNTS = {
  _count: {
    select: {
      cars: true,
      garageBrands: { where: { stance: 'works_on' as const } },
    },
  },
};

const adminRow = (brand: Counted): AdminBrandDto => ({
  cars: brand._count.cars,
  garages: brand._count.garageBrands,
  id: brand.id,
  name: brand.name,
  slug: brand.slug,
  state: brand.active ? 'active' : 'retired',
  updatedAt: brand.updatedAt.toISOString(),
  updatedBy: brand.updatedBy,
});

// The brand an edit asks for, after the body check and the stale check, in
// that order; the holder check and the no-op come after.
function edited(before: Counted, body: UpdateBrandDto) {
  if (body.name === undefined && body.active === undefined) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'Send a name, a state or both',
    );
  }
  const slug = body.name === undefined ? before.slug : slugFor(body.name);
  if (Date.parse(body.seenUpdatedAt) !== before.updatedAt.getTime()) {
    throw new HttpException(
      {
        brand: adminRow(before),
        code: 'stale_value',
        message: 'The brand changed since it was read',
      },
      HttpStatus.CONFLICT,
    );
  }
  return {
    active: body.active ?? before.active,
    name: body.name ?? before.name,
    slug,
  };
}

// PostgreSQL holds the list; Redis keeps a copy every change drops.
@Injectable()
export class BrandsService {
  private readonly logger = new Logger('Brands');
  private redisDown = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  // Every brand, retired ones too, with what points to it.
  async list(actor: Actor, q = ''): Promise<AdminBrandListDto> {
    requireCapability(actor, 'admin.catalogue');
    const wanted = fold(q.trim());
    const brands = await this.prisma.brand.findMany({ include: COUNTS });
    const items = brands
      .filter((brand) => fold(brand.name).includes(wanted))
      .map((brand) => ({ brand, folded: fold(brand.name) }))
      .sort((a, b) => (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0))
      .map(({ brand }) => adminRow(brand));
    return { items };
  }

  // An admin's new brand: key and slug from its name, owned by the admin so
  // the loader leaves it alone.
  async create(actor: Actor, body: CreateBrandDto): Promise<AdminBrandDto> {
    requireCapability(actor, 'admin.catalogue');
    const slug = slugFor(body.name);
    const created = await this.prisma
      .$transaction(async (tx) => {
        await this.refuseHeld(tx, slug);
        const brand = await tx.brand.create({
          data: {
            key: slug,
            name: body.name,
            slug,
            updatedBy: actor.accountId,
          },
          include: COUNTS,
        });
        await this.audit.record(tx, {
          action: 'create',
          actorId: actor.accountId,
          actorRole: actor.role,
          newValue: { active: true, name: brand.name, slug },
          subjectId: brand.id,
          subjectType: 'brand',
        });
        return brand;
      })
      .catch((error: unknown) => this.clash(error, slug));
    await dropActiveBrands(this.redis, this.logger);
    this.logger.log(`brand created id=${created.id} admin=${actor.accountId}`);
    return adminRow(created);
  }

  // A rename, a retirement or a bring-back, checked in the spec's order.
  async update(
    actor: Actor,
    id: string,
    body: UpdateBrandDto,
  ): Promise<AdminBrandDto> {
    requireCapability(actor, 'admin.catalogue');
    const outcome = await this.prisma
      .$transaction((tx) => this.edit(tx, actor, id, body))
      .catch((error: unknown) => this.clash(error, slugOf(body.name ?? '')));
    if (outcome.changed) {
      await dropActiveBrands(this.redis, this.logger);
      this.logger.log(`brand updated id=${id} admin=${actor.accountId}`);
    }
    return adminRow(outcome.brand);
  }

  // Under the row's lock, so a second save on the same seen value waits and
  // is refused as stale.
  private async edit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    id: string,
    body: UpdateBrandDto,
  ) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM brand WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    const before = await tx.brand.findUniqueOrThrow({
      include: COUNTS,
      where: { id },
    });
    const after = edited(before, body);
    if (after.slug !== before.slug) await this.refuseHeld(tx, after.slug, id);
    if (EDITED.every((field) => after[field] === before[field])) {
      return { brand: before, changed: false };
    }
    const brand = await tx.brand.update({
      data: { ...after, updatedBy: actor.accountId },
      include: COUNTS,
      where: { id },
    });
    await this.audit.recordChanges(
      tx,
      {
        actorId: actor.accountId,
        actorRole: actor.role,
        subjectId: id,
        subjectType: 'brand',
      },
      { active: before.active, name: before.name, slug: before.slug },
      after,
    );
    return { brand, changed: true };
  }

  // A brand other than `except` holding the slug, as slug or as key; checked
  // on the slug, so accents and case never make a second brand.
  private async refuseHeld(
    tx: Prisma.TransactionClient,
    slug: string,
    except?: string,
  ) {
    const holder = await tx.brand.findFirst({
      select: { name: true },
      where: {
        OR: [{ slug }, { key: slug }],
        ...(except && { id: { not: except } }),
      },
    });
    if (holder) throw taken(holder.name);
  }

  // Two admins adding the same brand at once: the unique constraints refuse
  // the second, answered as the slug check would have.
  private async clash(error: unknown, slug: string): Promise<never> {
    if (!isUniqueClash(error)) throw error;
    const holder = await this.prisma.brand.findFirst({
      select: { name: true },
      where: { OR: [{ slug }, { key: slug }] },
    });
    throw taken(holder?.name ?? slug);
  }

  async search(q = '', cursor?: string): Promise<BrandPageDto> {
    const wanted = fold(q.trim());
    const matches = (await this.active()).filter((brand) =>
      fold(brand.name).includes(wanted),
    );
    let start = 0;
    if (cursor !== undefined) {
      start = matches.findIndex((brand) => brand.id === cursor) + 1;
      if (start === 0) {
        throw refusal(
          HttpStatus.BAD_REQUEST,
          'invalid_cursor',
          'cursor is not a brand of this search',
        );
      }
    }
    const items = matches.slice(start, start + PAGE);
    const more = start + PAGE < matches.length;
    return {
      items,
      nextCursor: more ? (items.at(-1)?.id ?? null) : null,
      total: matches.length,
    };
  }

  private async active(): Promise<BrandDto[]> {
    const key = await this.cache(
      async () => `brands:active:${(await this.redis.get(VERSION_KEY)) ?? 0}`,
    );
    const cached = await this.cache(async () => {
      if (!key) return null;
      const text = await this.redis.get(key);
      if (!text) return null;
      const list: unknown = JSON.parse(text);
      return Array.isArray(list) ? (list as BrandDto[]) : null;
    });
    if (cached) return cached;
    const brands = await this.prisma.brand.findMany({
      orderBy: [
        { popularity: { nulls: 'last', sort: 'asc' } },
        { name: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        popularity: true,
        roPossessive: true,
        slug: true,
      },
      where: { active: true },
    });
    if (key) {
      await this.cache(() =>
        this.redis.set(key, JSON.stringify(brands), 'EX', CACHE_SECONDS),
      );
    }
    return brands;
  }

  private async cache<T>(command: () => Promise<T>) {
    try {
      const result = await command();
      this.redisDown = false;
      return result;
    } catch (error) {
      if (!this.redisDown) {
        this.logger.warn(
          `brand cache unavailable or unreadable: ${String(error)}`,
        );
        this.redisDown = true;
      }
      return null;
    }
  }
}
