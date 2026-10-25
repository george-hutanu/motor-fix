import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CAR_SYSTEM,
  type CarSystemRecord,
  type LicensedCarModel,
} from './models-3d';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { PRISMA } from '../../auth/prisma';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { CarModelFileError, validateCarModels } from '../car-models';

const SYSTEM = { actorId: null, actorRole: 'system' } as const;

type Fields = Record<string, unknown>;

// Compared as sets: the database may return an array in another order.
const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? [...a].sort().join() === [...b].sort().join()
    : a === b;

// Makes the stored car systems and 3D models match the data file: one
// transaction, so a refused file changes nothing, and two API replicas
// booting together take turns. The file owns every row: a field that differs
// is overwritten, a row gone from the file is deleted, each change audited.
@Injectable()
export class Models3dLoader {
  private readonly logger = new Logger('Models3dLoader');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async load(models: readonly LicensedCarModel[]) {
    validateCarModels(models);
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('models_3d_loader'))`;
      return (
        (await this.syncSystems(tx, CAR_SYSTEM)) +
        (await this.syncModels(tx, models))
      );
    });
    this.logger.log(`3D catalogue loaded: ${changed} changed`);
    return { changed };
  }

  private async syncSystems(
    tx: Prisma.TransactionClient,
    systems: readonly CarSystemRecord[],
  ) {
    const stored = await tx.carSystem.findMany();
    return this.sync(tx, 'car_system', stored, (row) => row.code, {
      create: (data) => tx.carSystem.create({ data }),
      delete: (id) => tx.carSystem.delete({ where: { id } }),
      rows: systems.map((s) => ({
        code: s.code,
        fuelTypes: [...s.fuelTypes],
        nameEn: s.nameEn,
        nameRo: s.nameRo,
        position: s.position,
      })),
      update: (id, data) => tx.carSystem.update({ data, where: { id } }),
    });
  }

  private async syncModels(
    tx: Prisma.TransactionClient,
    models: readonly LicensedCarModel[],
  ) {
    const brands = await tx.brand.findMany({
      select: { id: true, key: true },
      where: { key: { in: models.map((m) => m.brand) } },
    });
    const brandIds = new Map(brands.map((b) => [b.key, b.id]));
    const rows = models.map((m) => {
      const brandId = brandIds.get(m.brand);
      if (brandId === undefined) {
        throw new CarModelFileError(
          `model "${m.key}" names the brand "${m.brand}", which is not stored`,
        );
      }
      return {
        bodyStyle: m.bodyStyle,
        brandId,
        fileKey: m.file,
        fuel: m.fuel,
        key: m.key,
        model: m.model,
        popularity: m.rank,
      };
    });
    const stored = await tx.carModel3d.findMany();
    return this.sync(tx, 'car_model_3d', stored, (row) => row.key, {
      create: (data) => tx.carModel3d.create({ data }),
      delete: (id) => tx.carModel3d.delete({ where: { id } }),
      rows,
      update: (id, data) => tx.carModel3d.update({ data, where: { id } }),
    });
  }

  // Creates, updates and deletes so the stored rows equal `rows`, matched by
  // `keyOf`; returns how many rows it wrote.
  private async sync<S extends { id: string }, R extends Fields>(
    tx: Prisma.TransactionClient,
    subjectType: string,
    stored: readonly S[],
    keyOf: (row: S | R) => string,
    write: {
      rows: readonly R[];
      create: (data: R) => Promise<{ id: string }>;
      update: (id: string, data: Partial<R>) => Promise<unknown>;
      delete: (id: string) => Promise<unknown>;
    },
  ) {
    const byKey = new Map(stored.map((row) => [keyOf(row), row]));
    let changed = 0;
    // Deletes first, so a key or position a withdrawn row held is free.
    const keys = new Set(write.rows.map(keyOf));
    for (const row of stored.filter((r) => !keys.has(keyOf(r)))) {
      await write.delete(row.id);
      await this.audit.record(tx, {
        ...SYSTEM,
        action: 'delete',
        oldValue: row,
        subjectId: row.id,
        subjectType,
      });
      changed++;
    }
    for (const row of write.rows) {
      const before = byKey.get(keyOf(row)) as (S & Fields) | undefined;
      if (before === undefined) {
        const created = await write.create(row);
        await this.audit.record(tx, {
          ...SYSTEM,
          action: 'create',
          newValue: row,
          subjectId: created.id,
          subjectType,
        });
        changed++;
        continue;
      }
      const fields = Object.fromEntries(
        Object.entries(row).filter(
          ([field, value]) => !same(before[field], value),
        ),
      ) as Partial<R>;
      if (Object.keys(fields).length === 0) continue;
      await write.update(before.id, fields);
      await this.audit.recordChanges(
        tx,
        { ...SYSTEM, subjectId: before.id, subjectType },
        before,
        fields,
      );
      changed++;
    }
    return changed;
  }
}
