import {
  checkPriceRange,
  ENTRIES_MAX,
  type FieldProblem,
  fold,
  JOB_NAME_MAX,
  JOB_NAME_MIN,
  JOBS_MAX,
  type StartingPricesInput,
  type StartingPricesResult,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal, taken } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import { uniqueSlug } from '../garage-slug';
import { isRecord, plainText } from '../plain-text';

type Job = StartingPricesInput['jobs'][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSet = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

// The job an entry names: a catalogue id, or a proposed name folded so that
// accents and case do not make two jobs of one.
const jobOf = (job: Job) =>
  isSet(job.jobTypeId)
    ? `id:${job.jobTypeId}`
    : `name:${fold((job.name ?? '').trim())}`;

// One range per job and brand; no brand is the job's default range.
const pairOf = (job: string, brandId?: string | null) =>
  `${job}/${brandId ?? ''}`;

// A range whose start the payload checks have already required.
const started = <T extends { fromBani?: number | null }>(range: T) => ({
  ...range,
  fromBani: range.fromBani as number,
});

const prefixed = (prefix: string, problems: FieldProblem[]) =>
  problems.map(({ code, field }) => ({ code, field: `${prefix}.${field}` }));

const refuse = (errors: FieldProblem[]) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The prices cannot be saved',
    errors,
  );

const idOrNone = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string';

// A list of objects whose ids and proposed name, when given, are strings:
// what the checks below can read without failing.
const wellShaped = (jobs: unknown) =>
  Array.isArray(jobs) &&
  jobs.every(
    (job) =>
      isRecord(job) &&
      idOrNone(job['brandId']) &&
      idOrNone(job['jobTypeId']) &&
      idOrNone(job['name']),
  );

// PostgreSQL reads a uuid in either case; lower case lets the payload's own
// checks see the same id written two ways as one.
// A labour that is not an object counts as one with no ends.
const sameCase = (input: StartingPricesInput): StartingPricesInput => ({
  jobs: input.jobs.map((job) => ({
    ...job,
    brandId: job.brandId?.toLowerCase() ?? job.brandId,
    jobTypeId: job.jobTypeId?.toLowerCase() ?? job.jobTypeId,
  })),
  labour:
    typeof input.labour === 'object' && input.labour !== null
      ? input.labour
      : {},
});

function labourErrors(labour: StartingPricesInput['labour']) {
  const errors: FieldProblem[] = [];
  if (!isSet(labour.fromBani)) {
    errors.push({ code: 'required', field: 'labour.from' });
  }
  if (!isSet(labour.toBani)) {
    errors.push({ code: 'required', field: 'labour.to' });
  }
  if (isSet(labour.fromBani)) {
    errors.push(...prefixed('labour', checkPriceRange(started(labour)).errors));
  }
  return errors;
}

// What one entry gets wrong on its own: which job it names, and its range.
function entryErrors(job: Job, i: number) {
  const errors: FieldProblem[] = [];
  if (isSet(job.jobTypeId) === isSet(job.name)) {
    errors.push({ code: 'required', field: `jobs[${i}].jobTypeId` });
  } else if (isSet(job.name)) {
    const length = plainText(job.name).trim().length;
    if (length < JOB_NAME_MIN || length > JOB_NAME_MAX) {
      errors.push({ code: 'length', field: `jobs[${i}].name` });
    }
  }
  if (!isSet(job.fromBani)) {
    errors.push({ code: 'required', field: `jobs[${i}].from` });
  } else {
    errors.push(
      ...prefixed(`jobs[${i}]`, checkPriceRange(started(job)).errors),
    );
  }
  return errors;
}

// The field errors a payload carries on its own, before any lookup.
function payloadErrors({ jobs, labour }: StartingPricesInput) {
  const errors = labourErrors(labour);
  const defaults = jobs.filter((job) => !job.brandId);
  if (defaults.length > JOBS_MAX || jobs.length > ENTRIES_MAX) {
    return [...errors, { code: 'too_many', field: 'jobs' }];
  }
  const withDefault = new Set(defaults.map(jobOf));
  const seen = new Set<string>();
  jobs.forEach((job, i) => {
    const own = entryErrors(job, i);
    errors.push(...own);
    if (own.some((e) => e.code === 'required')) return;
    const pair = pairOf(jobOf(job), job.brandId);
    if (seen.has(pair)) {
      const field = isSet(job.name) ? 'name' : 'jobTypeId';
      errors.push({ code: 'duplicate', field: `jobs[${i}].${field}` });
    }
    seen.add(pair);
    if (job.brandId && !withDefault.has(jobOf(job))) {
      errors.push({ code: 'no_default_range', field: `jobs[${i}].brandId` });
    }
  });
  return errors;
}

// Saves the prices a garage gives when it sends its listing. Runs inside the
// caller's transaction, so the listing, its prices and the jobs it proposes
// land together or not at all; a refusal writes nothing.
@Injectable()
export class GaragePricesService {
  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async saveStarting(
    tx: Prisma.TransactionClient,
    garageId: string,
    actorId: string,
    given: StartingPricesInput,
  ): Promise<StartingPricesResult> {
    if (!wellShaped(given.jobs)) {
      throw refuse([{ code: 'invalid', field: 'jobs' }]);
    }
    const input = sameCase(given);
    const garage = await tx.garage.findUniqueOrThrow({
      select: { labourFromBani: true, labourToBani: true },
      where: { id: garageId },
    });
    const errors = payloadErrors(input);
    if (errors.length === 0) {
      errors.push(...(await this.catalogueErrors(tx, garageId, input.jobs)));
    }
    if (errors.length > 0) throw refuse(errors);
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
    const proposed = await this.propose(tx, scope, input.jobs);
    const jobs: StartingPricesResult['jobs'] = [];
    for (const [position, job] of input.jobs.entries()) {
      const fields = {
        brandId: job.brandId ?? null,
        durationMinutes: null,
        fromBani: job.fromBani as number,
        jobTypeId: job.jobTypeId ?? (proposed.get(jobOf(job)) as string),
        position,
        toBani: job.toBani ?? null,
        visible: true as const,
      };
      const row = await tx.garagePrice
        .create({ data: { ...fields, garageId, updatedBy: actorId } })
        .catch((error: unknown) => {
          // A concurrent save of the same garage stored the pair first.
          if (!taken(error)) throw error;
          throw refuse([
            { code: 'duplicate', field: `jobs[${position}].jobTypeId` },
          ]);
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
        warnings: checkPriceRange(started(job)).warnings,
      });
    }
    return {
      jobs,
      labour: {
        fromBani,
        toBani,
        warnings: checkPriceRange(started(input.labour)).warnings,
      },
    };
  }

  // One pending catalogue job per proposed name, with its audit entry and
  // the admins' event; answers the new id by the entry's job.
  private async propose(
    tx: Prisma.TransactionClient,
    scope: { actorId: string; actorRole: 'garage'; garageId: string },
    jobs: readonly Job[],
  ) {
    const ids = new Map<string, string>();
    for (const [i, job] of jobs.entries()) {
      if (!isSet(job.name) || ids.has(jobOf(job))) continue;
      const name = job.name.trim();
      // Another garage proposing the same name at once took the key first.
      const clash = refuse([{ code: 'duplicate', field: `jobs[${i}].name` }]);
      const key = await uniqueSlug(name, (candidates) =>
        tx.jobType
          .findMany({
            select: { key: true },
            where: { key: { in: candidates } },
          })
          .then((rows) => rows.map((row) => row.key)),
      );
      if (!key) throw clash;
      const created = await tx.jobType
        .create({
          data: {
            key,
            nameEn: name,
            nameRo: name,
            proposedByGarageId: scope.garageId,
            status: 'pending',
          },
        })
        .catch((error: unknown) => {
          if (!taken(error)) throw error;
          throw clash;
        });
      await this.audit.record(tx, {
        ...scope,
        action: 'create',
        newValue: { key, name_en: name, name_ro: name, status: 'pending' },
        subjectId: created.id,
        subjectType: 'job_type',
      });
      await this.events.record(tx, {
        audience: { adminOnly: true, type: 'platform' },
        kind: 'catalogue_job.proposed',
        payload: { garageId: scope.garageId, jobTypeId: created.id },
        subjectId: created.id,
      });
      ids.set(jobOf(job), created.id);
    }
    return ids;
  }

  // Jobs and brands the catalogue does not hold, brands the garage does not
  // take, and ranges already stored.
  private async catalogueErrors(
    tx: Prisma.TransactionClient,
    garageId: string,
    jobs: readonly Job[],
  ) {
    const jobIds = [
      ...new Set(jobs.flatMap((job) => (job.jobTypeId ? [job.jobTypeId] : []))),
    ];
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
    const takenBrands = await tx.garageBrand.findMany({
      select: { brandId: true },
      where: { garageId, stance: 'works_on' },
    });
    const stored = await tx.garagePrice.findMany({
      select: { brandId: true, jobTypeId: true },
      where: { garageId },
    });
    const status = new Map(jobTypes.map((job) => [job.id, job.status]));
    const known = new Set(brands.map((brand) => brand.id));
    const worksOn = new Set(takenBrands.map((row) => row.brandId));
    const storedPairs = new Set(
      stored.map((row) => pairOf(`id:${row.jobTypeId}`, row.brandId)),
    );
    const jobProblem = (job: Job) => {
      if (job.jobTypeId === undefined) return undefined;
      const jobStatus = status.get(job.jobTypeId);
      if (!jobStatus) return 'unknown_job';
      if (jobStatus !== 'approved') return 'not_approved';
      return storedPairs.has(pairOf(jobOf(job), job.brandId))
        ? 'duplicate'
        : undefined;
    };
    const brandProblem = ({ brandId }: Job) => {
      if (!brandId) return undefined;
      if (!known.has(brandId)) return 'unknown_brand';
      return worksOn.has(brandId) ? undefined : 'not_taken';
    };
    return jobs.flatMap((job, i) => {
      const onJob = jobProblem(job);
      const onBrand = brandProblem(job);
      return [
        ...(onJob ? [{ code: onJob, field: `jobs[${i}].jobTypeId` }] : []),
        ...(onBrand ? [{ code: onBrand, field: `jobs[${i}].brandId` }] : []),
      ];
    });
  }
}
