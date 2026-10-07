import {
  CHECK_DETAIL_MAX,
  checkSummary,
  RECORDED_RESULTS,
  VERIFICATION_CHECK_KINDS,
  type VerificationCheckKind,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { type Actor, requireCapability } from '../auth/policy';
import { refusal } from '../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type {
  Prisma,
  VerificationCheck,
  VerificationFileStatus,
} from '../generated/prisma/client';

export interface CheckRecord {
  result: string;
  detail?: string;
  activities?: string[];
}

// A decision waits for the garage or closes the file; reopening it into review
// lets the admin record again.
const DECIDED: VerificationFileStatus[] = [
  'approved',
  'rejected',
  'more_requested',
];

const invalid = (message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message);

const isKind = (kind: string): kind is VerificationCheckKind =>
  (VERIFICATION_CHECK_KINDS as readonly string[]).includes(kind);

// The detail as stored: trimmed, at most 200 characters, required for a problem.
function detailOf(body: CheckRecord) {
  const detail = body.detail?.trim() || null;
  if (detail && detail.length > CHECK_DETAIL_MAX) {
    throw invalid(`detail must be at most ${CHECK_DETAIL_MAX} characters`);
  }
  if (body.result !== 'ok' && !detail) {
    throw invalid('a warning or a failure needs a detail');
  }
  return detail;
}

// The body's own rules, beyond its shape: a problem says what it is, and a
// list belongs to the activities check alone.
function validated(kind: VerificationCheckKind, body: CheckRecord) {
  if (!(RECORDED_RESULTS as readonly string[]).includes(body.result)) {
    throw invalid('result must be ok, warning or failed');
  }
  const detail = detailOf(body);
  if (body.activities !== undefined && kind !== 'activities') {
    throw invalid('activities belong to the activities check');
  }
  if (kind === 'activities' && body.result === 'ok' && !body.activities) {
    throw invalid('an ok activities check needs the list');
  }
  return {
    activities: body.activities && [...new Set(body.activities)],
    detail,
    result: body.result as (typeof RECORDED_RESULTS)[number],
  };
}

// An admin's record of one check of a file, in the caller's transaction: the
// result, its history entry and its event commit together.
@Injectable()
export class VerificationChecksService {
  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    fileId: string,
    kind: string,
    body: CheckRecord,
  ) {
    requireCapability(actor, 'admin.garages');
    const file = await this.file(tx, fileId);
    if (DECIDED.includes(file.status)) {
      throw refusal(
        HttpStatus.CONFLICT,
        'verification_file_decided',
        'Dosarul e deja decis',
      );
    }
    if (!isKind(kind)) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'verification_check_kind_unknown',
        `Unknown check kind: ${kind}`,
      );
    }
    const next = validated(kind, body);
    if (next.activities) await this.known(tx, next.activities);

    const [before] = await tx.$queryRaw<
      Pick<VerificationCheck, 'id' | 'result' | 'detail'>[]
    >`SELECT id, result::text AS result, detail FROM verification_check
      WHERE file_id = ${fileId}::uuid AND kind = ${kind}::verification_check_kind
      FOR UPDATE`;
    if (!before) throw new NotFoundException();
    const check = await tx.verificationCheck.update({
      data: {
        detail: next.detail,
        recordedAt: new Date(),
        recordedBy: actor.accountId,
        result: next.result,
      },
      where: { id: before.id },
    });
    const activities = next.activities && {
      after: next.activities,
      before: await this.lockedActivities(tx, file.garageId),
    };
    if (activities) {
      await tx.garage.update({
        data: { rarActivities: activities.after },
        where: { id: file.garageId },
      });
    }

    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: kind,
      garageId: file.garageId,
      kind: 'verification_check_recorded',
      newValue: {
        ...(activities && { activities: activities.after }),
        detail: check.detail,
        result: check.result,
      },
      oldValue: {
        ...(activities && { activities: activities.before }),
        detail: before.detail,
        result: before.result,
      },
      subjectId: check.id,
      subjectType: 'verification_check',
    });
    await this.events.record(tx, {
      audience: { type: 'platform' },
      kind: 'verification.check_recorded',
      payload: { fileId, kind, result: check.result },
      subjectId: fileId,
    });

    const checks = await tx.verificationCheck.findMany({
      select: { detail: true, kind: true, result: true },
      where: { fileId },
    });
    const garage = await tx.garage.findUniqueOrThrow({
      select: { rarActivities: true },
      where: { id: file.garageId },
    });
    return {
      check,
      rarActivities: garage.rarActivities,
      summary: {
        en: checkSummary(checks, 'en'),
        ro: checkSummary(checks, 'ro'),
      },
    };
  }

  private async file(tx: Prisma.TransactionClient, id: string) {
    // PostgreSQL refuses a malformed uuid outright; it is an unknown id.
    if (!isUUID(id)) throw new NotFoundException();
    const file = await tx.verificationFile.findUnique({
      select: { garageId: true, status: true },
      where: { id },
    });
    if (!file) throw new NotFoundException();
    return file;
  }

  private async known(tx: Prisma.TransactionClient, codes: string[]) {
    const found = await tx.rarActivity.count({
      where: { code: { in: codes } },
    });
    if (found !== codes.length) throw invalid('unknown RAR activity code');
  }

  // The garage's list before the save, held until it commits.
  private async lockedActivities(
    tx: Prisma.TransactionClient,
    garageId: string,
  ) {
    const [garage] = await tx.$queryRaw<{ rar_activities: string[] }[]>`
      SELECT rar_activities FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
    return garage?.rar_activities ?? [];
  }
}
