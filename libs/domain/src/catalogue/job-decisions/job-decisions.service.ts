import type {
  AdminCatalogueJobsDto,
  ApproveCatalogueJobDto,
  CarSystem,
  CatalogueJobDecisionDto,
  RejectCatalogueJobDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { firstName } from '../../audit/audit.service';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import {
  approvedNames,
  nameOf,
} from '../../garages/prices/garage-prices/garage-prices.service';
import type {
  JobType,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';

const byRomanianName = new Intl.Collator('ro');

type Decision = 'approved' | 'rejected';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such catalogue job');

// An admin's decision on a job a garage proposed: approved into the
// catalogue with its names and system, or rejected with the reason the
// garage reads. One transaction behind the job's row lock, so a second
// decision is refused with the first decider's name.
@Injectable()
export class JobDecisionsService {
  private readonly logger = new Logger('CatalogueJobs');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // The pending jobs, oldest first, each with its garage and that garage's
  // default range, and the RAR activities the approval may name.
  async queue(actor: Actor): Promise<AdminCatalogueJobsDto> {
    requireCapability(actor, 'admin.catalogue');
    const [jobs, activities] = await Promise.all([
      this.prisma.jobType.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          createdAt: true,
          id: true,
          nameRo: true,
          prices: {
            select: {
              durationMinutes: true,
              fromBani: true,
              garageId: true,
              toBani: true,
            },
            where: { brandId: null },
          },
          proposedBy: { select: { id: true, name: true, slug: true } },
        },
        where: { status: 'pending' },
      }),
      this.prisma.rarActivity.findMany({
        select: { code: true, nameEn: true, nameRo: true },
      }),
    ]);
    return {
      items: jobs.map(({ createdAt, id, nameRo, prices, proposedBy }) => {
        const row = prices.find((p) => p.garageId === proposedBy?.id);
        return {
          id,
          name: nameRo,
          proposedAt: createdAt.toISOString(),
          ...(proposedBy && { garage: proposedBy }),
          ...(row && { fromBani: row.fromBani }),
          ...(row?.toBani != null && { toBani: row.toBani }),
          ...(row?.durationMinutes != null && {
            durationMinutes: row.durationMinutes,
          }),
        };
      }),
      rarActivities: activities.sort((a, b) =>
        byRomanianName.compare(a.nameRo, b.nameRo),
      ),
    };
  }

  async approve(
    actor: Actor,
    id: string,
    body: ApproveCatalogueJobDto,
  ): Promise<CatalogueJobDecisionDto> {
    requireCapability(actor, 'admin.catalogue');
    const nameRo = body.nameRo.trim();
    const nameEn = body.nameEn.trim();
    const rarActivity = body.rarActivity ?? null;
    if (rarActivity !== null) await this.knownActivity(rarActivity);
    const job = await this.decide(
      actor,
      id,
      { carSystem: body.carSystem, nameEn, nameRo, rarActivity },
      {
        car_system: body.carSystem,
        name_en: nameEn,
        name_ro: nameRo,
        rar_activity: rarActivity,
        status: 'approved',
      },
      (tx) => this.unique(tx, { nameEn, nameRo }),
    );
    return {
      carSystem: job.carSystem as CarSystem,
      decidedAt: (job.decidedAt as Date).toISOString(),
      id,
      nameEn: job.nameEn,
      nameRo: job.nameRo,
      rarActivity: job.rarActivity,
      status: 'approved',
    };
  }

  async reject(
    actor: Actor,
    id: string,
    body: RejectCatalogueJobDto,
  ): Promise<CatalogueJobDecisionDto> {
    requireCapability(actor, 'admin.catalogue');
    const reason = body.reason.trim();
    const job = await this.decide(
      actor,
      id,
      { rejectionReason: reason },
      { rejection_reason: reason, status: 'rejected' },
    );
    return {
      decidedAt: (job.decidedAt as Date).toISOString(),
      id,
      nameEn: job.nameEn,
      nameRo: job.nameRo,
      rejectionReason: reason,
      status: 'rejected',
    };
  }

  // Both decisions: behind the row lock, the job's move with the decider,
  // its audit entry and its events in one transaction; then one log line,
  // never the reason's text.
  private async decide(
    actor: Actor,
    id: string,
    fields: Prisma.JobTypeUncheckedUpdateInput,
    newValue: { status: Decision } & Record<string, string | null>,
    check?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<JobType> {
    const decision = newValue.status;
    const job = await this.prisma.$transaction(async (tx) => {
      await this.pending(tx, id);
      await check?.(tx);
      const decided = await tx.jobType.update({
        data: {
          ...fields,
          decidedAt: new Date(),
          decidedBy: actor.accountId,
          status: decision,
        },
        where: { id },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        newValue,
        oldValue: { status: 'pending' },
        subjectId: id,
        subjectType: 'job_type',
      });
      const garageId = decided.proposedByGarageId;
      await this.events.record(tx, {
        audience: { garageId, type: 'catalogue_job' },
        kind: 'catalogue_job.decided',
        payload: { decision, jobTypeId: id, ...(garageId && { garageId }) },
        subjectId: id,
      });
      if (decision === 'approved') await this.republish(tx, decided);
      return decided;
    });
    this.logger.log(
      `decided job=${id} decision=${decision} admin=${actor.accountId}`,
    );
    return job;
  }

  private async knownActivity(code: string) {
    const known = await this.prisma.rarActivity.findUnique({
      select: { code: true },
      where: { code },
    });
    if (!known) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'unknown_activity',
        'No such RAR activity',
        [{ code: 'unknown', field: 'rarActivity' }],
      );
    }
  }

  // The job's row lock: a second decision waits here, then is refused with
  // the first decider's first name.
  private async pending(tx: Prisma.TransactionClient, id: string) {
    const [locked] = await tx.$queryRaw<
      { status: string; decided_by: string | null }[]
    >`
      SELECT status::text AS status, decided_by::text AS decided_by
      FROM job_type WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    if (locked.status === 'pending') return;
    const decider = locked.decided_by
      ? await tx.account.findUnique({
          select: { name: true },
          where: { id: locked.decided_by },
        })
      : null;
    throw new HttpException(
      {
        code: 'already_decided',
        currentStatus: locked.status,
        message: decider
          ? `Already ${locked.status} by ${firstName(decider.name)}`
          : 'Already decided',
        ...(decider && { decidedBy: firstName(decider.name) }),
      },
      HttpStatus.CONFLICT,
    );
  }

  // Neither name may be either name of an approved job, accents and case
  // ignored, as a proposal's may not. The approvals take the catalogue's
  // name lock before they read, so two of one name run one after the other
  // and the second sees the first. Only an approval makes a name approved
  // (the loader writes keys it owns), so a proposal, which stays pending,
  // does not take it.
  private async unique(
    tx: Prisma.TransactionClient,
    names: { nameEn: string; nameRo: string },
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('job_type_names'))`;
    const approved = await approvedNames(tx);
    for (const field of ['nameRo', 'nameEn'] as const) {
      const jobTypeId = approved.get(nameOf(names[field]));
      if (!jobTypeId) continue;
      const { nameRo } = await tx.jobType.findUniqueOrThrow({
        select: { nameRo: true },
        where: { id: jobTypeId },
      });
      throw new HttpException(
        {
          code: 'exists',
          errors: [{ code: 'exists', field }],
          jobTypeId,
          message: `Already in the catalogue: ${nameRo}`,
          nameRo,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  // The proposer's Prețuri and public profile re-read when the job's default
  // row is still theirs.
  private async republish(tx: Prisma.TransactionClient, job: JobType) {
    const garageId = job.proposedByGarageId;
    if (!garageId) return;
    const row = await tx.garagePrice.findFirst({
      select: { id: true },
      where: { brandId: null, garageId, jobTypeId: job.id },
    });
    if (!row) return;
    await this.events.record(tx, {
      audience: { garageId, results: false, type: 'public_garage' },
      kind: 'price_list.updated',
      payload: { brandIds: [], garageId, jobTypeIds: [job.id] },
      subjectId: garageId,
    });
  }
}
