import {
  type BrandRangeDto,
  type BrandRangeSavedDto,
  checkPriceRange,
  type FieldProblem,
  type PriceListDto,
  type PriceListUpdatedPayload,
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

const refuse = (errors: FieldProblem[]) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The brand range cannot be saved',
    errors,
  );

const missing = (value: unknown) => value === undefined || value === null;
// Anything but a number is judged as one that is not whole.
const asNumber = (value: unknown) =>
  typeof value === 'number' ? value : Number.NaN;

const RANGE_FIELD: Record<string, string> = { from: 'fromBani', to: 'toBani' };
const named = (problems: FieldProblem[]) =>
  problems.map(({ code, field }) => ({
    code,
    field: RANGE_FIELD[field] ?? field,
  }));

// The one range check on the body, with a missing end as `required`. A
// missing low price is judged as 0, whose `min` stands in for nothing and
// keeps the top from being compared with it.
function rangeOf({ fromBani, toBani }: BrandRangeDto) {
  const checked = checkPriceRange({
    fromBani: missing(fromBani) ? 0 : asNumber(fromBani),
    toBani: missing(toBani) ? null : asNumber(toBani),
  });
  const errors = named(checked.errors).filter(
    ({ field }) => !(field === 'fromBani' && missing(fromBani)),
  );
  if (missing(fromBani)) errors.push({ code: 'required', field: 'fromBani' });
  if (missing(toBani)) errors.push({ code: 'required', field: 'toBani' });
  return {
    errors,
    fromBani: fromBani as number,
    toBani: toBani as number,
    warnings: named(checked.warnings),
  };
}

type Pair = { brandId: string; garageId: string; jobTypeId: string };

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
    const range = rangeOf(body);
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

    const { fromBani, toBani, warnings } = range;
    const saved = { brandId, fromBani, jobTypeId, toBani, warnings };
    const own = rows.find((row) => row.brandId === brandId);
    if (own?.fromBani === fromBani && own.toBani === toBani) return saved;
    await this.prisma.$transaction(async (tx) => {
      const scope = this.scopeOf(actor, garageId);
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
          newValue: { brandId, fromBani, jobTypeId, toBani },
          oldValue: {
            brandId,
            fromBani: own.fromBani,
            jobTypeId,
            toBani: own.toBani,
          },
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
          newValue: fields,
          subjectId: row.id,
        });
      }
      await this.changed(tx, pair);
    });
    await this.forget(garage.slug, brand.slug);
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
        ...this.scopeOf(actor, garageId),
        action: 'delete',
        oldValue: {
          brandId,
          fromBani: own.fromBani,
          jobTypeId,
          toBani: own.toBani,
        },
        subjectId: own.id,
      });
      await this.changed(tx, pair);
    });
    await this.forget(own.garage.slug, brandSlug);
  }

  private scopeOf(actor: Actor, garageId: string) {
    return {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      subjectType: 'garage_price',
    };
  }

  // An open profile and the owner's price list re-read on it.
  private changed(tx: Prisma.TransactionClient, pair: Pair) {
    const payload: PriceListUpdatedPayload = {
      brandIds: [pair.brandId],
      garageId: pair.garageId,
      jobTypeIds: [pair.jobTypeId],
    };
    return this.events.record(tx, {
      audience: {
        garageId: pair.garageId,
        results: false,
        type: 'public_garage',
      },
      kind: 'price_list.updated',
      payload,
      subjectId: pair.garageId,
    });
  }

  // The profile read for the written brand answers the new range at once,
  // not after the cached entry's soft period; the relay purges the rest.
  private forget(garageSlug: string, brandSlug: string) {
    return this.cache.take(cacheKey('profile', garageSlug, brandSlug));
  }
}
