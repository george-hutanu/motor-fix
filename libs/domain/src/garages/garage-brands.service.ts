import { ConflictException, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { type Actor, assertGarage } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import type {
  GarageBrandStance,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client';

// In the brief's order, which is the order the history lists them in.
const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'] as const;

const fuels = (on: boolean) =>
  Object.fromEntries(FUELS.map((fuel) => [fuel, on])) as Record<
    (typeof FUELS)[number],
    boolean
  >;

// The rules that span a garage's brand row and its jobs; the one-row rules
// (no fuel on a refused brand, the text limits) are CHECKs in the database.
@Injectable()
export class GarageBrandsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async stanceFor(
    garageId: string,
    brandId: string,
  ): Promise<GarageBrandStance | 'unstated'> {
    const row = await this.prisma.garageBrand.findUnique({
      select: { stance: true },
      where: { garageId_brandId: { brandId, garageId } },
    });
    return row?.stance ?? 'unstated';
  }

  // A refused brand loses its fuels and jobs; a brand taken (back) on gets
  // all four fuels.
  async setStance(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    brandId: string,
    stance: GarageBrandStance,
  ) {
    assertGarage(actor, garageId);
    const where = { garageId_brandId: { brandId, garageId } };
    const row = await tx.garageBrand.findUnique({ where });
    if (row?.stance === stance) return;
    const after = { stance, ...fuels(stance === 'works_on') };
    const change = {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      subjectId: brandId,
      subjectType: 'garage_brand',
    };
    if (!row) {
      await tx.garageBrand.create({ data: { ...after, brandId, garageId } });
      await this.audit.record(tx, {
        ...change,
        action: 'create',
        newValue: after,
      });
      return;
    }
    await tx.garageBrand.update({ data: after, where });
    await this.audit.recordChanges(tx, change, row, after);
    if (stance === 'works_on') return;
    const jobs = await tx.garageBrandJob.findMany({
      where: { brandId, garageId },
    });
    await tx.garageBrandJob.deleteMany({ where: { brandId, garageId } });
    for (const job of jobs) {
      await this.audit.record(tx, {
        ...change,
        action: 'delete',
        oldValue: { brandId },
        subjectId: job.jobTypeId,
        subjectType: 'garage_brand_job',
      });
    }
  }

  async addJob(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    brandId: string,
    jobTypeId: string,
  ) {
    assertGarage(actor, garageId);
    const row = await tx.garageBrand.findUnique({
      select: { stance: true },
      where: { garageId_brandId: { brandId, garageId } },
    });
    if (row?.stance !== 'works_on') {
      throw new ConflictException({
        code: 'brand_not_worked_on',
        message: 'The garage does not work on this brand',
      });
    }
    const { count } = await tx.garageBrandJob.createMany({
      data: { brandId, garageId, jobTypeId },
      skipDuplicates: true,
    });
    if (count === 0) return;
    await this.audit.record(tx, {
      action: 'create',
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      newValue: { brandId },
      subjectId: jobTypeId,
      subjectType: 'garage_brand_job',
    });
  }
}
