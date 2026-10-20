import {
  type BrandRangeDto,
  type BrandRangeSavedDto,
  checkPriceRange,
  type FieldProblem,
  type LabourRangeDto,
  type LabourRangeSavedDto,
  type PriceListDto,
  type PriceListUpdatedPayload,
  type PriceRangeDto,
  type PriceRangeSavedDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { PRICE_ROW_SELECT, priceListJobs } from './price-list';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal, taken } from '../../auth/sign-up.service';
import { CacheService, cacheKey } from '../../cache/cache.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  assertGarageOwner,
  notFound,
} from '../garage-brands/garage-brands.service';
import { NO_BRAND } from '../public-garages/public-garages';

const refuse = (errors: FieldProblem[]) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The range cannot be saved',
    errors,
  );

const stale = () =>
  refusal(
    HttpStatus.CONFLICT,
    'stale',
    'The price list changed since it was read',
  );

const missing = (value: unknown) => value === undefined || value === null;
// Anything but a number is judged as one that is not whole.
const asNumber = (value: unknown) =>
  typeof value === 'number' ? value : Number.NaN;

const RANGE_FIELD: Record<string, string> = {
  duration: 'durationMinutes',
  from: 'fromBani',
  to: 'toBani',
};
const named = (problems: FieldProblem[]) =>
  problems.map(({ code, field }) => ({
    code,
    field: RANGE_FIELD[field] ?? field,
  }));

interface RangeBody {
  fromBani?: unknown;
  toBani?: unknown;
  durationMinutes?: unknown;
}

const judged = (value: unknown) => (missing(value) ? null : asNumber(value));

// The fields left out: a brand or labour range needs both ends; a job's
// default row needs every field sent, where a null top or duration clears it.
function requiredOf(body: RangeBody, withDuration: boolean) {
  const absent = withDuration
    ? (value: unknown) => value === undefined
    : missing;
  const fields = withDuration
    ? (['toBani', 'durationMinutes'] as const)
    : (['toBani'] as const);
  return [
    ...(missing(body.fromBani) ? ['fromBani'] : []),
    ...fields.filter((field) => absent(body[field])),
  ].map((field) => ({ code: 'required', field }));
}

// The one range check on the body. A missing low price is judged as 0, whose
// `min` stands in for nothing and keeps the top from being compared with it.
function rangeOf(body: RangeBody, withDuration: boolean) {
  const { durationMinutes, fromBani, toBani } = body;
  const checked = checkPriceRange({
    fromBani: judged(fromBani) ?? 0,
    toBani: judged(toBani),
    ...(withDuration && { durationMinutes: judged(durationMinutes) }),
  });
  const errors = [
    ...named(checked.errors).filter(
      ({ field }) => !(field === 'fromBani' && missing(fromBani)),
    ),
    ...requiredOf(body, withDuration),
  ];
  return {
    durationMinutes: (durationMinutes ?? null) as number | null,
    errors,
    fromBani: fromBani as number,
    toBani: (toBani ?? null) as number | null,
    warnings: named(checked.warnings),
  };
}

type Pair = { brandId: string; garageId: string; jobTypeId: string };
type Row = { garageId: string; priceId: string };

// The pair travels with the range so a deleted row's entry still names it.
const brandRange = (pair: Pair, from: number, to: number | null) => ({
  brandId: pair.brandId,
  from,
  jobTypeId: pair.jobTypeId,
  to,
});

const pairChange = (pair: Pair) => ({
  brandIds: [pair.brandId],
  garageId: pair.garageId,
  jobTypeIds: [pair.jobTypeId],
});

@Injectable()
export class PriceListService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly cache: CacheService,
  ) {}

  // The owner's price list, each job with whether drivers see it and why not.
  async read(actor: Actor, garageId: string): Promise<PriceListDto> {
    assertGarageOwner(actor, garageId);
    const garage = await this.prisma.garage.findUnique({
      select: {
        labourFromBani: true,
        labourToBani: true,
        prices: { select: PRICE_ROW_SELECT },
        rarActivities: true,
      },
      where: { id: garageId },
    });
    if (!garage) throw notFound();
    const { labourFromBani, labourToBani } = garage;
    return {
      items: priceListJobs(garage.prices, garage.rarActivities),
      ...(labourFromBani !== null &&
        labourToBani !== null && {
          labour: { fromBani: labourFromBani, toBani: labourToBani },
        }),
    };
  }

  // The job's own range for a brand the garage takes: a new row for the pair,
  // or the pair's row changed in place, so one row per job and brand holds.
  async setBrandRange(
    actor: Actor,
    pair: Pair,
    body: BrandRangeDto,
  ): Promise<BrandRangeSavedDto> {
    const { brandId, garageId, jobTypeId } = pair;
    assertGarageOwner(actor, garageId);
    const [garage, brand, rows] = await Promise.all([
      this.prisma.garage.findUnique({
        select: {
          brands: { select: { stance: true }, where: { brandId } },
          slug: true,
        },
        where: { id: garageId },
      }),
      this.prisma.brand.findUnique({
        select: { slug: true },
        where: { id: brandId },
      }),
      this.prisma.garagePrice.findMany({
        select: {
          brandId: true,
          fromBani: true,
          id: true,
          position: true,
          toBani: true,
        },
        where: { garageId, jobTypeId },
      }),
    ]);
    if (!garage) throw notFound();
    const range = rangeOf(body, false);
    const errors = [...range.errors];
    if (!brand) errors.push({ code: 'unknown_brand', field: 'brandId' });
    else if (garage.brands[0]?.stance !== 'works_on') {
      errors.push({ code: 'not_taken', field: 'brandId' });
    }
    const defaultRow = rows.find((row) => row.brandId === null);
    if (rows.length === 0)
      errors.push({ code: 'unknown_job', field: 'jobTypeId' });
    else if (!defaultRow) {
      errors.push({ code: 'no_default_range', field: 'jobTypeId' });
    }
    if (errors.length > 0 || !brand || !defaultRow) throw refuse(errors);

    const { fromBani, warnings } = range;
    const toBani = range.toBani as number;
    const saved = { brandId, fromBani, jobTypeId, toBani, warnings };
    const own = rows.find((row) => row.brandId === brandId);
    if (own?.fromBani === fromBani && own.toBani === toBani) return saved;
    await this.prisma.$transaction(async (tx) => {
      const scope = {
        ...this.scopeOf(actor, garageId, 'garage_price'),
        field: 'brand_range',
      };
      // A removal racing this write took the row first: it is stored anew.
      const { count } = own
        ? await tx.garagePrice.updateMany({
            data: { fromBani, toBani, updatedBy: actor.accountId },
            where: { id: own.id },
          })
        : { count: 0 };
      if (own && count > 0) {
        await this.audit.record(tx, {
          ...scope,
          action: 'update',
          newValue: brandRange(pair, fromBani, toBani),
          oldValue: brandRange(pair, own.fromBani, own.toBani),
          subjectId: own.id,
        });
      } else {
        const fields = {
          brandId,
          durationMinutes: null,
          fromBani,
          jobTypeId,
          position: defaultRow.position,
          toBani,
          visible: true as const,
        };
        const row = await tx.garagePrice
          .create({ data: { ...fields, garageId, updatedBy: actor.accountId } })
          .catch((error: unknown) => {
            // A concurrent write of the same pair stored it first.
            if (!taken(error)) throw error;
            throw refuse([{ code: 'duplicate', field: 'brandId' }]);
          });
        await this.audit.record(tx, {
          ...scope,
          action: 'create',
          newValue: brandRange(pair, fromBani, toBani),
          subjectId: row.id,
        });
      }
      await this.changed(tx, pairChange(pair));
    });
    await this.forget(garage.slug, brand.slug);
    return saved;
  }

  // A job's default range changed in place, judged against the stamp the
  // owner read it with: a row changed since answers 409 and keeps the newer
  // save, whatever this one would have written.
  async setRange(
    actor: Actor,
    { garageId, priceId }: Row,
    body: PriceRangeDto,
  ): Promise<PriceRangeSavedDto> {
    assertGarageOwner(actor, garageId);
    const row = await this.prisma.garagePrice.findFirst({
      select: {
        durationMinutes: true,
        fromBani: true,
        garage: { select: { slug: true } },
        jobTypeId: true,
        toBani: true,
        updatedAt: true,
      },
      where: { brandId: null, garageId, id: priceId },
    });
    if (!row) throw notFound();
    const range = rangeOf(body, true);
    if (range.errors.length > 0) throw refuse(range.errors);
    const read = new Date(body.expectedUpdatedAt).getTime();
    if (read !== row.updatedAt.getTime()) throw stale();

    const { durationMinutes, fromBani, toBani, warnings } = range;
    const { jobTypeId } = row;
    const answer = (updatedAt: Date): PriceRangeSavedDto => ({
      fromBani,
      jobTypeId,
      priceId,
      ...(toBani !== null && { toBani }),
      ...(durationMinutes !== null && { durationMinutes }),
      updatedAt: updatedAt.toISOString(),
      warnings,
    });
    const unchanged =
      row.fromBani === fromBani &&
      row.toBani === toBani &&
      row.durationMinutes === durationMinutes;
    if (unchanged) return answer(row.updatedAt);
    const updatedAt = await this.prisma.$transaction(async (tx) => {
      // A save racing this one changed the row first.
      const { count } = await tx.garagePrice.updateMany({
        data: { durationMinutes, fromBani, toBani, updatedBy: actor.accountId },
        where: { id: priceId, updatedAt: row.updatedAt },
      });
      if (count === 0) throw stale();
      await this.audit.recordChanges(
        tx,
        {
          ...this.scopeOf(actor, garageId, 'garage_price'),
          subjectId: priceId,
        },
        {
          duration_minutes: row.durationMinutes,
          range: { from: row.fromBani, to: row.toBani },
        },
        {
          duration_minutes: durationMinutes,
          range: { from: fromBani, to: toBani },
        },
      );
      await this.changed(tx, {
        brandIds: [],
        garageId,
        jobTypeIds: [jobTypeId],
      });
      const saved = await tx.garagePrice.findUniqueOrThrow({
        select: { updatedAt: true },
        where: { id: priceId },
      });
      return saved.updatedAt;
    });
    await this.forget(row.garage.slug, NO_BRAND);
    return answer(updatedAt);
  }

  // The garage's labour rate, both ends always set.
  async setLabour(
    actor: Actor,
    garageId: string,
    body: LabourRangeDto,
  ): Promise<LabourRangeSavedDto> {
    assertGarageOwner(actor, garageId);
    const garage = await this.prisma.garage.findUnique({
      select: { labourFromBani: true, labourToBani: true, slug: true },
      where: { id: garageId },
    });
    if (!garage) throw notFound();
    const range = rangeOf(body, false);
    if (range.errors.length > 0) throw refuse(range.errors);
    const { fromBani, warnings } = range;
    const toBani = range.toBani as number;
    const saved = { fromBani, toBani, warnings };
    if (garage.labourFromBani === fromBani && garage.labourToBani === toBani) {
      return saved;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.garage.update({
        data: { labourFromBani: fromBani, labourToBani: toBani },
        where: { id: garageId },
      });
      await this.audit.record(tx, {
        ...this.scopeOf(actor, garageId, 'garage'),
        action: 'update',
        field: 'labour_range',
        newValue: { from: fromBani, to: toBani },
        oldValue: { from: garage.labourFromBani, to: garage.labourToBani },
        subjectId: garageId,
      });
      await this.changed(tx, { brandIds: [], garageId, jobTypeIds: [] });
    });
    await this.forget(garage.slug, NO_BRAND);
    return saved;
  }

  // Removes the job's range for a brand, whatever the garage's answer for the
  // brand now is; the default range has no route here.
  async removeBrandRange(actor: Actor, pair: Pair): Promise<void> {
    const { brandId, garageId, jobTypeId } = pair;
    assertGarageOwner(actor, garageId);
    const own = await this.prisma.garagePrice.findFirst({
      select: {
        brand: { select: { slug: true } },
        fromBani: true,
        garage: { select: { slug: true } },
        id: true,
        toBani: true,
      },
      where: { brandId, garageId, jobTypeId },
    });
    if (!own?.brand) throw notFound();
    const brandSlug = own.brand.slug;
    await this.prisma.$transaction(async (tx) => {
      // A removal racing this one took the row first.
      const { count } = await tx.garagePrice.deleteMany({
        where: { id: own.id },
      });
      if (count === 0) throw notFound();
      await this.audit.record(tx, {
        ...this.scopeOf(actor, garageId, 'garage_price'),
        action: 'delete',
        field: 'brand_range',
        oldValue: brandRange(pair, own.fromBani, own.toBani),
        subjectId: own.id,
      });
      await this.changed(tx, pairChange(pair));
    });
    await this.forget(own.garage.slug, brandSlug);
  }

  private scopeOf(
    actor: Actor,
    garageId: string,
    subjectType: 'garage' | 'garage_price',
  ) {
    return {
      actorId: actor.accountId,
      actorRole: actor.role,
      assistantGrantId: actor.assistantGrantId,
      garageId,
      kind: 'price_list',
      requestId: actor.requestId,
      subjectType,
    };
  }

  // An open profile and the owner's price list re-read on it.
  private changed(
    tx: Prisma.TransactionClient,
    payload: PriceListUpdatedPayload & { garageId: string },
  ) {
    const { garageId } = payload;
    return this.events.record(tx, {
      audience: { garageId, results: false, type: 'public_garage' },
      kind: 'price_list.updated',
      payload,
      subjectId: garageId,
    });
  }

  // The profile read for the written brand answers the new range at once,
  // not after the cached entry's soft period; the relay purges the rest.
  private forget(garageSlug: string, brandSlug: string) {
    return this.cache.take(cacheKey('profile', garageSlug, brandSlug));
  }
}
