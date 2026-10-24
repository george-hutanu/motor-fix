import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  BrandFileError,
  type BrandRecord,
  slugOf,
  validateFile,
} from './brands/brands';
import { dropActiveBrands } from './brands/brands.service';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { AUTH_REDIS } from '../auth/attempts';
import { PRISMA } from '../auth/prisma';
import type { Brand, Prisma, PrismaClient } from '../generated/prisma/client';

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
      await dropActiveBrands(this.redis, this.logger);
    }
    return { changed };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    records: readonly BrandRecord[],
  ) {
    // A brand an admin changed is the admin's: the file neither updates nor
    // retires it, and a record that would collide with it is skipped.
    const all = await tx.brand.findMany();
    const owned = all.filter((brand) => brand.updatedBy !== null);
    const stored = all.filter((brand) => brand.updatedBy === null);
    const kept = records.filter((record) => {
      const slug = slugOf(record.name);
      const holder = owned.find(
        (brand) =>
          brand.key === record.key ||
          brand.name === record.name ||
          brand.slug === slug,
      );
      if (holder) {
        this.logger.warn(
          `brand ${record.key} skipped: held by the admin-changed brand ${holder.key}`,
        );
      }
      return !holder;
    });
    refuseHeldNames(stored, kept);
    const byKey = new Map(stored.map((brand) => [brand.key, brand]));
    let changed = 0;
    for (const record of kept) {
      const brand = byKey.get(record.key);
      // The file's rank seeds a new brand or a stored one with no rank; a rank
      // already held is the nightly ranking's and stays.
      const after = {
        active: true,
        name: record.name,
        popularity: brand?.popularity ?? record.popularity ?? null,
        roPossessive: record.roPossessive ?? null,
        slug: slugOf(record.name),
      };
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
    fields: Pick<
      Brand,
      'active' | 'name' | 'popularity' | 'roPossessive' | 'slug'
    >,
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
    after: Partial<
      Pick<Brand, 'active' | 'name' | 'popularity' | 'roPossessive' | 'slug'>
    >,
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
// or retired, would make two brands one. Two brands swapping names are refused
// too: the operator renames one through a temporary name over two loads.
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
        `"${record.name}" is held by the stored brand ${holder.key}: rename one brand to a temporary name first, load, then load again`,
      );
    }
  }
}
