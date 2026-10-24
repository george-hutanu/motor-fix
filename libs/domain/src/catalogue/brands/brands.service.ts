import { type BrandDto, type BrandPageDto, fold } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { refusal } from '../../auth/http-refusal';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

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

// PostgreSQL holds the list; Redis keeps a copy every change drops.
@Injectable()
export class BrandsService {
  private readonly logger = new Logger('Brands');
  private redisDown = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

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
