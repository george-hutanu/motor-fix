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

import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../../audit/audit.port';
import { refusal } from '../../../auth/http-refusal';
import { taken } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  GaragePrice,
  JobTypeStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { uniqueSlug } from '../../garage-slug';
import { isRecord, plainText } from '../../plain-text';

type Job = StartingPricesInput['jobs'][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSet = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

// A job name folded so that accents, case and surrounding spaces do not make
// two jobs of one.
export const nameOf = (name: string) => `name:${fold(name.trim())}`;

// The job an entry names: a catalogue id, or a proposed name.
const jobOf = (job: Job) =>
  isSet(job.jobTypeId) ? `id:${job.jobTypeId}` : nameOf(job.name ?? '');

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

const rowKey = (row: { jobTypeId: string; brandId: string | null }) =>
  pairOf(row.jobTypeId, row.brandId);

// What a price row is created with, recorded as its audit entry's new value.
type RowFields = {
  brandId: string | null;
  durationMinutes: number | null;
  fromBani: number;
  jobTypeId: string;
  position: number;
  toBani: number | null;
  visible: true;
};

type RowScope = Omit<
  AuditEntry,
  'action' | 'newValue' | 'subjectId' | 'subjectType'
> & { actorId: string; garageId: string };

// The approved catalogue jobs by each of their names, folded. The catalogue
// holds tens of jobs, so one read and a match in memory.
export async function approvedNames(tx: Prisma.TransactionClient) {
  const approved = await tx.jobType.findMany({
    select: { id: true, nameEn: true, nameRo: true },
    where: { status: 'approved' },
  });
  return new Map(
    approved.flatMap(({ id, nameEn, nameRo }) => [
      [nameOf(nameRo), id],
      [nameOf(nameEn), id],
    ]),
  );
}

// Why a catalogue job cannot be put on a garage's list, if it cannot.
export function jobProblem(status: JobTypeStatus | undefined, listed: boolean) {
  if (!status) return 'unknown_job';
  if (status !== 'approved') return 'not_approved';
  return listed ? 'duplicate' : undefined;
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
    const { fromBani, input, toBani } = await this.checked(tx, garageId, given);
    const garage = await tx.garage.findUniqueOrThrow({
      select: { labourFromBani: true, labourToBani: true },
      where: { id: garageId },
    });
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
    const proposed = await this.proposeAll(tx, scope, input.jobs);
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
      const row = await this.createRow(
        tx,
        scope,
        fields,
        refuse([{ code: 'duplicate', field: `jobs[${position}].jobTypeId` }]),
      );
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

  // Step 3 sent again over a live garage: rows matched by job and brand, so
  // only what differs is written, one history entry each. A name the garage
  // proposed before is its pending job again, not a second proposal.
  // `worksOn` is the brands the same sending takes, written after the prices.
  async saveAgain(
    tx: Prisma.TransactionClient,
    garageId: string,
    actorId: string,
    given: StartingPricesInput,
    worksOn?: readonly string[],
  ): Promise<StartingPricesResult> {
    const { fromBani, input, toBani } = await this.checked(
      tx,
      garageId,
      given,
      { worksOn },
    );
    const scope = { actorId, actorRole: 'garage' as const, garageId };
    await this.labourAgain(tx, scope, fromBani, toBani);
    const ids = await this.jobIds(tx, scope, input.jobs);
    const wanted = input.jobs.map((job, position) => ({
      brandId: job.brandId ?? null,
      durationMinutes: null,
      fromBani: job.fromBani as number,
      jobTypeId: ids.get(jobOf(job)) as string,
      position,
      toBani: job.toBani ?? null,
      visible: true as const,
    }));
    const stored = await this.dropRows(tx, scope, wanted);
    const jobs: StartingPricesResult['jobs'] = [];
    for (const [i, fields] of wanted.entries()) {
      const row = stored.find((one) => rowKey(one) === rowKey(fields));
      const id = row
        ? await this.updateRow(tx, scope, row, fields)
        : (
            await this.createRow(
              tx,
              scope,
              fields,
              refuse([{ code: 'duplicate', field: `jobs[${i}].jobTypeId` }]),
            )
          ).id;
      const warnings = checkPriceRange(started(input.jobs[i] as Job)).warnings;
      jobs.push({ ...fields, id, warnings });
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

  // Step 3 as sent, refused unless every field and catalogue job holds.
  private async checked(
    tx: Prisma.TransactionClient,
    garageId: string,
    given: StartingPricesInput,
    again?: { worksOn?: readonly string[] },
  ) {
    if (!isRecord(given as unknown))
      throw refuse([{ code: 'invalid', field: 'section' }]);
    if (!wellShaped(given.jobs)) {
      throw refuse([{ code: 'invalid', field: 'jobs' }]);
    }
    const input = sameCase(given);
    const errors = payloadErrors(input);
    if (errors.length === 0) {
      errors.push(
        ...(await this.catalogueErrors(tx, garageId, input.jobs, again)),
      );
    }
    if (errors.length > 0) throw refuse(errors);
    const { fromBani, toBani } = input.labour as {
      fromBani: number;
      toBani: number;
    };
    return { fromBani, input, toBani };
  }

  // Deletes the stored rows the sending no longer lists; answers the rest.
  private async dropRows(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    wanted: readonly RowFields[],
  ) {
    const stored = await tx.garagePrice.findMany({
      where: { garageId: scope.garageId },
    });
    const kept = new Set(wanted.map(rowKey));
    for (const row of stored.filter((one) => !kept.has(rowKey(one)))) {
      await tx.garagePrice.delete({ where: { id: row.id } });
      await this.audit.record(tx, {
        ...scope,
        action: 'delete',
        oldValue: {
          brand_id: row.brandId,
          from_bani: row.fromBani,
          job_type_id: row.jobTypeId,
          to_bani: row.toBani,
        },
        subjectId: row.id,
        subjectType: 'garage_price',
      });
    }
    return stored.filter((row) => kept.has(rowKey(row)));
  }

  private async labourAgain(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    fromBani: number,
    toBani: number,
  ) {
    const { garageId } = scope;
    const garage = await tx.garage.findUniqueOrThrow({
      select: { labourFromBani: true, labourToBani: true },
      where: { id: garageId },
    });
    if (garage.labourFromBani === fromBani && garage.labourToBani === toBani) {
      return;
    }
    await tx.garage.update({
      data: { labourFromBani: fromBani, labourToBani: toBani },
      where: { id: garageId },
    });
    await this.audit.recordChanges(
      tx,
      { ...scope, subjectId: garageId, subjectType: 'garage' },
      {
        labour_from_bani: garage.labourFromBani,
        labour_to_bani: garage.labourToBani,
      },
      { labour_from_bani: fromBani, labour_to_bani: toBani },
    );
  }

  // A stored row moved to the range and place the sending gives it; answers
  // its id.
  private async updateRow(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    row: GaragePrice,
    fields: RowFields,
  ) {
    const before = {
      from_bani: row.fromBani,
      position: row.position,
      to_bani: row.toBani,
    };
    const after = {
      from_bani: fields.fromBani,
      position: fields.position,
      to_bani: fields.toBani,
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return row.id;
    await tx.garagePrice.update({
      data: {
        fromBani: fields.fromBani,
        position: fields.position,
        toBani: fields.toBani,
        updatedBy: scope.actorId,
      },
      where: { id: row.id },
    });
    await this.audit.recordChanges(
      tx,
      { ...scope, subjectId: row.id, subjectType: 'garage_price' },
      before,
      after,
    );
    return row.id;
  }

  // The catalogue id of each entry's job: its own, the garage's pending job
  // of the same name, or a job proposed now.
  private async jobIds(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    jobs: readonly Job[],
  ) {
    const pending = await tx.jobType.findMany({
      select: { id: true, nameRo: true },
      where: { proposedByGarageId: scope.garageId },
    });
    const ids = new Map<string, string>(
      pending.map((job) => [nameOf(job.nameRo), job.id]),
    );
    for (const [i, job] of jobs.entries()) {
      if (isSet(job.jobTypeId)) {
        ids.set(jobOf(job), job.jobTypeId);
        continue;
      }
      if (ids.has(jobOf(job))) continue;
      const clash = refuse([{ code: 'duplicate', field: `jobs[${i}].name` }]);
      ids.set(
        jobOf(job),
        await this.propose(tx, scope, job.name as string, clash),
      );
    }
    return ids;
  }

  // A price row with its audit entry; `clash` is thrown when a concurrent
  // write stored the same job and brand first.
  async createRow(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    fields: RowFields,
    clash: Error,
  ) {
    const { actorId, garageId } = scope;
    const row = await tx.garagePrice
      .create({ data: { ...fields, garageId, updatedBy: actorId } })
      .catch((error: unknown) => {
        if (!taken(error)) throw error;
        throw clash;
      });
    await this.audit.record(tx, {
      ...scope,
      action: 'create',
      newValue: fields,
      subjectId: row.id,
      subjectType: 'garage_price',
    });
    return row;
  }

  // One pending catalogue job per proposed name; answers the new id by the
  // entry's job.
  private async proposeAll(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    jobs: readonly Job[],
  ) {
    const ids = new Map<string, string>();
    for (const [i, job] of jobs.entries()) {
      if (!isSet(job.name) || ids.has(jobOf(job))) continue;
      // Another garage proposing the same name at once took the key first.
      const clash = refuse([{ code: 'duplicate', field: `jobs[${i}].name` }]);
      ids.set(jobOf(job), await this.propose(tx, scope, job.name, clash));
    }
    return ids;
  }

  // A pending catalogue job of the garage under the trimmed name, with its
  // audit entry and the admins' event; answers its id. `clash` is thrown
  // when a concurrent proposal took the key first.
  async propose(
    tx: Prisma.TransactionClient,
    scope: RowScope,
    given: string,
    clash: Error,
  ): Promise<string> {
    const name = given.trim();
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
    return created.id;
  }

  // Jobs and brands the catalogue does not hold, brands the garage does not
  // take, ranges already stored, and proposals of a job already approved.
  // A sending again (`again` given) matches its stored ranges, so they are
  // no duplicate, and checks the brands against the ones it takes.
  private async catalogueErrors(
    tx: Prisma.TransactionClient,
    garageId: string,
    jobs: readonly Job[],
    again?: { worksOn?: readonly string[] },
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
    const approved = await approvedNames(tx);
    const status = new Map(jobTypes.map((job) => [job.id, job.status]));
    const known = new Set(brands.map((brand) => brand.id));
    const worksOn = new Set(
      again?.worksOn?.map((id) => id.toLowerCase()) ??
        takenBrands.map((row) => row.brandId),
    );
    const storedPairs = new Set(
      stored.map((row) => pairOf(`id:${row.jobTypeId}`, row.brandId)),
    );
    const onCatalogue = (job: Job) =>
      job.jobTypeId === undefined
        ? undefined
        : jobProblem(
            status.get(job.jobTypeId),
            !again && storedPairs.has(pairOf(jobOf(job), job.brandId)),
          );
    const brandProblem = ({ brandId }: Job) => {
      if (!brandId) return undefined;
      if (!known.has(brandId)) return 'unknown_brand';
      return worksOn.has(brandId) ? undefined : 'not_taken';
    };
    return jobs.flatMap((job, i) => {
      const onJob = onCatalogue(job);
      const onBrand = brandProblem(job);
      const onName = isSet(job.name) && approved.has(jobOf(job));
      return [
        ...(onJob ? [{ code: onJob, field: `jobs[${i}].jobTypeId` }] : []),
        ...(onName ? [{ code: 'duplicate', field: `jobs[${i}].name` }] : []),
        ...(onBrand ? [{ code: onBrand, field: `jobs[${i}].brandId` }] : []),
      ];
    });
  }
}
