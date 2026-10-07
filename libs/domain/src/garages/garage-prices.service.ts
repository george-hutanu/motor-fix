import {
  checkPriceRange,
  type FieldProblem,
  type StartingPricesInput,
  type StartingPricesResult,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { refusal } from '../auth/sign-up.service';
import type { Prisma } from '../generated/prisma/client';

type Job = StartingPricesInput['jobs'][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One range per job and brand; no brand is the job's default range.
const pairOf = (jobTypeId: string, brandId?: string | null) =>
  `${jobTypeId}/${brandId ?? ''}`;

const prefixed = (prefix: string, problems: FieldProblem[]) =>
  problems.map(({ code, field }) => ({ code, field: `${prefix}.${field}` }));

// The field errors a payload carries on its own, before any lookup.
function payloadErrors({ jobs, labour }: StartingPricesInput) {
  const errors: FieldProblem[] = [];
  if (labour.toBani === null || labour.toBani === undefined) {
    errors.push({ code: 'required', field: 'labour.to' });
  }
  errors.push(...prefixed('labour', checkPriceRange(labour).errors));
  const defaults = new Set(
    jobs.filter((job) => !job.brandId).map((job) => job.jobTypeId),
  );
  const seen = new Set<string>();
  jobs.forEach((job, i) => {
    errors.push(...prefixed(`jobs[${i}]`, checkPriceRange(job).errors));
    const pair = pairOf(job.jobTypeId, job.brandId);
    if (seen.has(pair)) {
      errors.push({ code: 'duplicate', field: `jobs[${i}].jobTypeId` });
    }
    seen.add(pair);
    if (job.brandId && !defaults.has(job.jobTypeId)) {
      errors.push({ code: 'no_default_range', field: `jobs[${i}].brandId` });
    }
  });
  return errors;
}

// Saves the prices a garage gives when it sends its listing. Runs inside the
// caller's transaction, so the listing and its prices land together or not
// at all; a refusal writes nothing.
@Injectable()
export class GaragePricesService {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

  async saveStarting(
    tx: Prisma.TransactionClient,
    garageId: string,
    actorId: string,
    input: StartingPricesInput,
  ): Promise<StartingPricesResult> {
    const garage = await tx.garage.findUniqueOrThrow({
      select: { labourFromBani: true, labourToBani: true },
      where: { id: garageId },
    });
    const errors = payloadErrors(input);
    if (errors.length === 0) {
      errors.push(...(await this.catalogueErrors(tx, garageId, input.jobs)));
    }
    if (errors.length > 0) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation_failed',
        'The prices cannot be saved',
        errors,
      );
    }
    const { fromBani, toBani } = input.labour as {
      fromBani: number;
      toBani: number;
    };
    await tx.garage.update({
      data: { labourFromBani: fromBani, labourToBani: toBani },
      where: { id: garageId },
    });
    const scope = { actorId, actorRole: 'garage' as const, garageId };
    await this.audit.recordChanges(
      tx,
      { ...scope, subjectId: garageId, subjectType: 'garage' },
      {
        labour_from_bani: garage.labourFromBani,
        labour_to_bani: garage.labourToBani,
      },
      { labour_from_bani: fromBani, labour_to_bani: toBani },
    );
    const jobs: StartingPricesResult['jobs'] = [];
    for (const [position, job] of input.jobs.entries()) {
      const fields = {
        brandId: job.brandId ?? null,
        durationMinutes: job.durationMinutes ?? null,
        fromBani: job.fromBani,
        jobTypeId: job.jobTypeId,
        position,
        toBani: job.toBani ?? null,
        visible: true as const,
      };
      const row = await tx.garagePrice.create({
        data: { ...fields, garageId, updatedBy: actorId },
      });
      await this.audit.record(tx, {
        ...scope,
        action: 'create',
        newValue: fields,
        subjectId: row.id,
        subjectType: 'garage_price',
      });
      jobs.push({
        ...fields,
        id: row.id,
        warnings: checkPriceRange(job).warnings,
      });
    }
    return {
      jobs,
      labour: {
        fromBani,
        toBani,
        warnings: checkPriceRange(input.labour).warnings,
      },
    };
  }

  // Jobs and brands the catalogue does not hold, and ranges already stored.
  private async catalogueErrors(
    tx: Prisma.TransactionClient,
    garageId: string,
    jobs: readonly Job[],
  ) {
    const jobIds = [...new Set(jobs.map((job) => job.jobTypeId))];
    const brandIds = [
      ...new Set(jobs.flatMap((job) => (job.brandId ? [job.brandId] : []))),
    ];
    const jobTypes = await tx.jobType.findMany({
      select: { id: true, status: true },
      where: { id: { in: jobIds.filter((id) => UUID.test(id)) } },
    });
    // A brand retired from the catalogue still passes.
    const brands = await tx.brand.findMany({
      select: { id: true },
      where: { id: { in: brandIds.filter((id) => UUID.test(id)) } },
    });
    const stored = await tx.garagePrice.findMany({
      select: { brandId: true, jobTypeId: true },
      where: { garageId },
    });
    const status = new Map(jobTypes.map((job) => [job.id, job.status]));
    const known = new Set(brands.map((brand) => brand.id));
    const taken = new Set(
      stored.map((row) => pairOf(row.jobTypeId, row.brandId)),
    );
    const errors: FieldProblem[] = [];
    jobs.forEach((job, i) => {
      const jobStatus = status.get(job.jobTypeId);
      if (!jobStatus) {
        errors.push({ code: 'unknown_job', field: `jobs[${i}].jobTypeId` });
      } else if (jobStatus !== 'approved') {
        errors.push({ code: 'not_approved', field: `jobs[${i}].jobTypeId` });
      } else if (taken.has(pairOf(job.jobTypeId, job.brandId))) {
        errors.push({ code: 'duplicate', field: `jobs[${i}].jobTypeId` });
      }
      if (job.brandId && !known.has(job.brandId)) {
        errors.push({ code: 'unknown_brand', field: `jobs[${i}].brandId` });
      }
    });
    return errors;
  }
}
