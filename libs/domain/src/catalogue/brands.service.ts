import type { BrandDto, BrandPageDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ACTIVE_BRANDS_KEY } from './brand-loader';
import { fold } from './brands';
import { AUTH_REDIS } from '../auth/attempts';
import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import type { PrismaClient } from '../generated/prisma/client';

const PAGE = 20;
const CACHE_SECONDS = 3600;

// PostgreSQL holds the list; Redis keeps a copy the loader drops on a change.
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
    const cached = await this.cache(async () => {
      const text = await this.redis.get(ACTIVE_BRANDS_KEY);
      return text ? (JSON.parse(text) as BrandDto[]) : null;
    });
    if (cached) return cached;
    const brands = await this.prisma.brand.findMany({
      orderBy: [
        { popularity: { nulls: 'last', sort: 'asc' } },
        { name: 'asc' },
      ],
      select: { id: true, name: true, popularity: true, slug: true },
      where: { active: true },
    });
    await this.cache(() =>
      this.redis.set(
        ACTIVE_BRANDS_KEY,
        JSON.stringify(brands),
        'EX',
        CACHE_SECONDS,
      ),
    );
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
