import { Inject, Injectable, Logger } from '@nestjs/common';

import { type JobTypeRecord, validateJobTypes } from './job-types';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { PRISMA } from '../auth/prisma';
import type { JobType, Prisma, PrismaClient } from '../generated/prisma/client';

const SYSTEM = { actorId: null, actorRole: 'system' } as const;

// Makes the stored jobs of the file match it: one transaction, so a refused
// file changes nothing, and two API replicas booting together take turns.
// Only names follow the file; a job's status is the admins' once it exists.
@Injectable()
export class JobTypeLoader {
  private readonly logger = new Logger('JobTypeLoader');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async load(records: readonly JobTypeRecord[]) {
    validateJobTypes(records);
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('job_type_loader'))`;
      return this.apply(tx, records);
    });
    this.logger.log(`job types loaded: ${changed} changed`);
    return { changed };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    records: readonly JobTypeRecord[],
  ) {
    const stored = await tx.jobType.findMany({
      where: { key: { in: records.map((record) => record.key) } },
    });
    const byKey = new Map(stored.map((job) => [job.key, job]));
    let changed = 0;
    for (const record of records) {
      const job = byKey.get(record.key);
      const wrote = job
        ? await this.update(tx, job, record)
        : await this.create(tx, record);
      if (wrote) changed++;
    }
    return changed;
  }

  private async create(tx: Prisma.TransactionClient, record: JobTypeRecord) {
    const fields = { ...record, status: 'approved' as const };
    const created = await tx.jobType.create({ data: fields });
    await this.audit.record(tx, {
      ...SYSTEM,
      action: 'create',
      newValue: fields,
      subjectId: created.id,
      subjectType: 'job_type',
    });
    return true;
  }

  // Writes and records only the names that differ; false when none does.
  private async update(
    tx: Prisma.TransactionClient,
    job: JobType,
    record: JobTypeRecord,
  ) {
    const fields = Object.fromEntries(
      (['nameRo', 'nameEn'] as const)
        .filter((field) => job[field] !== record[field])
        .map((field) => [field, record[field]]),
    );
    if (Object.keys(fields).length === 0) return false;
    await tx.jobType.update({ data: fields, where: { id: job.id } });
    await this.audit.recordChanges(
      tx,
      { ...SYSTEM, subjectId: job.id, subjectType: 'job_type' },
      job,
      fields,
    );
    return true;
  }
}
