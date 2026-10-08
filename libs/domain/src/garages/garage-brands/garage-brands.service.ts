import {
  FUELS,
  type Fuel,
  fuelColumns,
  type GarageBrandAnswerDto,
  type ReplaceGarageBrandsDto,
} from '@motor-fix/contracts';
import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { type Actor, assertGarage } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  GarageBrandStance,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { brandAnswer } from '../brand-answer';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

// Only the owner answers; the garage's staff are told no, anyone else that
// there is no such garage.
export function assertOwner(actor: Actor, garageId: string) {
  if (actor.garageId !== garageId) throw notFound();
  if (actor.role !== 'garage') {
    throw refusal(
      HttpStatus.FORBIDDEN,
      'forbidden',
      'Only the owner changes the garage',
    );
  }
}

type Texts = { brandNote: string | null; refusalPhrase: string | null };

// Two writes to one garage's brands run one after the other.
async function lockGarage(tx: Prisma.TransactionClient, garageId: string) {
  const [garage] = await tx.$queryRaw<Texts[]>`
    SELECT brand_note AS "brandNote", refusal_phrase AS "refusalPhrase"
    FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
  if (!garage) throw notFound();
  return garage;
}

// The DTO judges each brand alone; fuels on a refused one span two fields.
function assertFuelsTaken(dto: ReplaceGarageBrandsDto) {
  const at = dto.brands.findIndex(
    (b) => b.stance === 'does_not_take' && b.fuels !== undefined,
  );
  if (at === -1) return;
  throw refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    'Only a taken brand has fuels',
    [{ code: 'fuels_on_refused', field: `brands[${at}].fuels` }],
  );
}

type Wanted = { stance: GarageBrandStance; fuels?: Fuel[] };

// A retired brand still passes; only one missing from the catalogue is refused.
async function assertCatalogued(tx: Prisma.TransactionClient, ids: string[]) {
  const known = await tx.brand.count({ where: { id: { in: ids } } });
  if (known === ids.length) return;
  throw refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    'A brand is not in the catalogue',
    [{ code: 'unknown_brand', field: 'brands' }],
  );
}

// The rules that span a garage's brand row and its jobs; the one-row rules
// (no fuel on a refused brand, the text limits) are CHECKs in the database.
@Injectable()
export class GarageBrandsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // The owner's whole answer at once: brands left out are switched off. The
  // garage row is locked, so two writes at once run one after the other.
  async replace(
    actor: Actor,
    garageId: string,
    dto: ReplaceGarageBrandsDto,
  ): Promise<GarageBrandAnswerDto> {
    assertOwner(actor, garageId);
    assertFuelsTaken(dto);
    return this.prisma.$transaction(async (tx) => {
      const garage = await lockGarage(tx, garageId);
      // Stored ids are lowercase; a uuid is accepted in either case.
      const wanted = new Map(
        dto.brands.map(({ brandId, fuels, stance }) => [
          brandId.toLowerCase(),
          { fuels, stance },
        ]),
      );
      await assertCatalogued(tx, [...wanted.keys()]);
      const { changed, fields } = await this.applyStances(
        tx,
        actor,
        garageId,
        wanted,
      );
      const texts = {
        brandNote: dto.brandNote ?? null,
        refusalPhrase: dto.refusalPhrase ?? null,
      };
      const textChanged = await this.applyTexts(
        tx,
        actor,
        garageId,
        garage,
        texts,
      );
      if (textChanged) fields.add('brands');
      if (fields.size > 0) {
        await this.events.record(tx, {
          audience: { brandIds: changed, garageId, type: 'garage_brands' },
          kind: 'garage.updated',
          payload: { brandIds: changed, fields: [...fields], garageId },
          subjectId: garageId,
        });
      }
      const rows = await tx.garageBrand.findMany({
        select: {
          brand: {
            select: { id: true, name: true, popularity: true, slug: true },
          },
          stance: true,
        },
        where: { garageId },
      });
      return brandAnswer(rows, texts);
    });
  }

  // Switches off the brands left out, then sets the others; returns the
  // brands whose stance or fuels changed, and which of the two did.
  private async applyStances(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    wanted: Map<string, Wanted>,
  ) {
    const rows = await tx.garageBrand.findMany({ where: { garageId } });
    const changed: string[] = [];
    const fields = new Set<'brands' | 'brand_fuels'>();
    for (const row of rows.filter((r) => !wanted.has(r.brandId))) {
      await this.switchOff(tx, actor, row);
      changed.push(row.brandId);
      fields.add('brands');
    }
    for (const [brandId, { fuels, stance }] of wanted) {
      const change = await this.setStance(
        tx,
        actor,
        garageId,
        brandId,
        stance,
        fuels,
      );
      if (!change.stance && !change.fuels) continue;
      changed.push(brandId);
      if (change.stance) fields.add('brands');
      if (change.fuels) fields.add('brand_fuels');
    }
    return { changed, fields };
  }

  private async applyTexts(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    before: Texts,
    after: Texts,
  ) {
    if (
      after.brandNote === before.brandNote &&
      after.refusalPhrase === before.refusalPhrase
    )
      return false;
    await tx.garage.update({ data: after, where: { id: garageId } });
    await this.audit.recordChanges(
      tx,
      {
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        subjectId: garageId,
        subjectType: 'garage',
      },
      before,
      after,
    );
    return true;
  }

  // A brand left out goes back to not stated: its row and its jobs go.
  private async switchOff(
    tx: Prisma.TransactionClient,
    actor: Actor,
    row: {
      garageId: string;
      brandId: string;
      stance: GarageBrandStance;
    } & Record<Fuel, boolean>,
  ) {
    const { brandId, garageId } = row;
    const change = {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
    };
    const jobs = await tx.garageBrandJob.findMany({
      where: { brandId, garageId },
    });
    await tx.garageBrand.delete({
      where: { garageId_brandId: { brandId, garageId } },
    });
    await this.audit.record(tx, {
      ...change,
      action: 'delete',
      oldValue: {
        stance: row.stance,
        ...Object.fromEntries(FUELS.map((fuel) => [fuel, row[fuel]])),
      },
      subjectId: brandId,
      subjectType: 'garage_brand',
    });
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
  // the fuels given, all four when none are. A brand already taken keeps its
  // fuels unless given. Says whether the stance and the fuels changed.
  async setStance(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    brandId: string,
    stance: GarageBrandStance,
    fuels?: Fuel[],
  ): Promise<{ stance: boolean; fuels: boolean }> {
    assertGarage(actor, garageId);
    // One stance write per garage at a time: two first writes would both miss
    // the row, and the second create would fail on the primary key.
    await tx.$executeRaw`SELECT 1 FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
    const where = { garageId_brandId: { brandId, garageId } };
    const row = await tx.garageBrand.findUnique({ where });
    const taken = stance === 'works_on';
    const columns = fuelColumns(taken ? fuels : []);
    const change = {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      subjectId: brandId,
      subjectType: 'garage_brand',
    };
    if (row?.stance === stance) {
      const moved = FUELS.filter((fuel) => row[fuel] !== columns[fuel]);
      if (!taken || fuels === undefined || moved.length === 0)
        return { fuels: false, stance: false };
      const after = Object.fromEntries(
        moved.map((fuel) => [fuel, columns[fuel]]),
      );
      await tx.garageBrand.update({ data: after, where });
      await this.audit.recordChanges(tx, change, row, after);
      return { fuels: true, stance: false };
    }
    const after = { stance, ...columns };
    if (!row) {
      await tx.garageBrand.create({ data: { ...after, brandId, garageId } });
      await this.audit.record(tx, {
        ...change,
        action: 'create',
        newValue: after,
      });
      return { fuels: false, stance: true };
    }
    await tx.garageBrand.update({ data: after, where });
    await this.audit.recordChanges(tx, change, row, after);
    const result = { fuels: false, stance: true };
    if (taken) return result;
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
    return result;
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
