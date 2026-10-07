import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  BrandFileError,
  type BrandRecord,
  slugOf,
  validateFile,
} from './brands';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { AUTH_REDIS } from '../auth/attempts';
import { PRISMA } from '../auth/prisma';
import type { Brand, Prisma, PrismaClient } from '../generated/prisma/client';

export const ACTIVE_BRANDS_KEY = 'brands:active';

const SYSTEM = { actorId: null, actorRole: 'system' } as const;

// Makes the stored brands match the file: one transaction, so a refused file
// changes nothing, and two API replicas booting together take turns.
@Injectable()
export class BrandLoader {
  private readonly logger = new Logger('BrandLoader');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  async load(records: readonly BrandRecord[]) {
    validateFile(records);
    const changed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('brand_loader'))`;
        return this.apply(tx, records);
      },
      // The full list is a few hundred brands, each audited on its first load.
      { timeout: 60_000 },
    );
    this.logger.log(`brands loaded: ${changed} changed`);
    if (changed > 0) {
      await this.redis.del(ACTIVE_BRANDS_KEY).catch((error: unknown) => {
        this.logger.warn(`brand cache not dropped: ${String(error)}`);
      });
    }
    return { changed };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    records: readonly BrandRecord[],
  ) {
    const stored = await tx.brand.findMany();
    refuseHeldNames(stored, records);
    const byKey = new Map(stored.map((brand) => [brand.key, brand]));
    let changed = 0;
    for (const record of records) {
      const after = {
        active: true,
        name: record.name,
        popularity: record.popularity ?? null,
        slug: slugOf(record.name),
      };
      const brand = byKey.get(record.key);
      const wrote = brand
        ? await this.update(tx, brand, after)
        : await this.create(tx, record.key, after);
      if (wrote) changed++;
    }
    const keys = new Set(records.map((record) => record.key));
    const retired = stored.filter((brand) => !keys.has(brand.key));
    for (const brand of retired) {
      if (await this.update(tx, brand, { active: false })) changed++;
    }
    return changed;
  }

  private async create(
    tx: Prisma.TransactionClient,
    key: string,
    fields: Pick<Brand, 'active' | 'name' | 'popularity' | 'slug'>,
  ) {
    const created = await tx.brand.create({ data: { ...fields, key } });
    await this.audit.record(tx, {
      ...SYSTEM,
      action: 'create',
      newValue: { ...fields, key },
      subjectId: created.id,
      subjectType: 'brand',
    });
    return true;
  }

  // Writes and records only the fields that differ; false when none does.
  private async update(
    tx: Prisma.TransactionClient,
    brand: Brand,
    after: Partial<Pick<Brand, 'active' | 'name' | 'popularity' | 'slug'>>,
  ) {
    const fields = Object.fromEntries(
      Object.entries(after).filter(
        ([field, value]) => brand[field as keyof typeof after] !== value,
      ),
    );
    if (Object.keys(fields).length === 0) return false;
    await tx.brand.update({ data: fields, where: { id: brand.id } });
    await this.audit.recordChanges(
      tx,
      { ...SYSTEM, subjectId: brand.id, subjectType: 'brand' },
      brand,
      fields,
    );
    return true;
  }
}

// A name or slug of the file held by a stored brand under another key, active
// or retired, would make two brands one.
function refuseHeldNames(
  stored: readonly Brand[],
  records: readonly BrandRecord[],
) {
  for (const record of records) {
    const slug = slugOf(record.name);
    const holder = stored.find(
      (brand) =>
        brand.key !== record.key &&
        (brand.name === record.name || brand.slug === slug),
    );
    if (holder) {
      throw new BrandFileError(
        `"${record.name}" is held by the stored brand ${holder.key}`,
      );
    }
  }
}
