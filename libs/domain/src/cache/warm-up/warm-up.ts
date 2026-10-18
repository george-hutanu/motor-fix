import { type INestApplicationContext, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { PRISMA } from '../../auth/prisma';
import {
  PublicGaragesService,
  publicGaragesSql,
} from '../../garages/public-garages/public-garages';
import type { PrismaClient } from '../../generated/prisma/client';
import { HomeService, homeRead } from '../../search/home/home.service';
import {
  PopularBrandsService,
  tilesRead,
} from '../../search/popular-brands/popular-brands.service';
import { CacheService } from '../cache.service';

const PROFILES = 200;
// The tiles the home page asks for by default.
const TILES = 8;

// Once per release, the first instance up fills the most-read profiles (views
// over the last 30 days, then the most recently approved) and the brand pages,
// one read at a time so live traffic keeps the database. A failure is one
// warning: the cache fills itself on the first reads anyway.
export async function warmCache(app: INestApplicationContext, release: string) {
  if (release === 'dev') return;
  const logger = new Logger('CacheWarmUp');
  try {
    const redis = app.get<Redis>(AUTH_REDIS);
    if (
      (await redis.set(`v1:warm:${release}`, '1', 'EX', 86_400, 'NX')) !== 'OK'
    ) {
      return;
    }
    const prisma = app.get<PrismaClient>(PRISMA);
    const cache = app.get(CacheService);
    const profiles = app.get(PublicGaragesService);
    const home = app.get(HomeService);
    const popular = app.get(PopularBrandsService);
    const rows = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT g.slug FROM garage g
      LEFT JOIN garage_daily_figures f
        ON f.garage_id = g.id AND f.day >= current_date - 30
      WHERE ${publicGaragesSql('g')}
      GROUP BY g.id
      ORDER BY COALESCE(SUM(f.profile_views), 0) DESC,
        g.approved_at DESC NULLS LAST, g.id
      LIMIT ${PROFILES}`;
    // A read that fails (a garage suspended meanwhile) skips that key only.
    const failed: unknown[] = [];
    const each = async (read: () => Promise<unknown>) => {
      await read().catch((error: unknown) => failed.push(error));
    };
    await cache.warm(async () => {
      for (const { slug } of rows) await each(() => profiles.bySlug(slug));
      const tiles = await cache.read(tilesRead(popular, TILES));
      for (const { slug } of tiles) {
        await each(() => cache.read(homeRead(home, slug)));
      }
    });
    if (failed.length > 0) {
      logger.warn(
        `cache warm-up skipped ${failed.length} reads: ${String(failed[0])}`,
      );
    }
  } catch (error) {
    logger.warn(`cache warm-up stopped: ${String(error)}`);
  }
}
