import type {
  AuditArea,
  AuditEntryDto,
  AuditHistoryPageDto,
  AuditHistoryQueryDto,
} from '@motor-fix/contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { type Actor, requireCapability } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import type {
  ActivityLog,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client';

const PAGE = 20;
const DEFAULT_DAYS = 7;

// Subject types are the Data model's table names; a module that writes a new
// subject type adds it to its area here.
const SUBJECTS: Record<Exclude<AuditArea, 'admin_actions'>, string[]> = {
  bookings: ['booking', 'booking_move', 'booking_segment', 'time_block'],
  garage_profile: [
    'garage',
    'garage_brand',
    'garage_facility',
    'garage_closed_day',
  ],
  jobs: ['job', 'job_stage_entry', 'job_step', 'job_part', 'odometer_reading'],
  photos: ['media_item', 'garage_photo', 'message_photo'],
  prices: ['garage_price', 'garage_brand_job'],
  quotes: ['quote', 'quote_job'],
  repair_history: ['repair', 'car_transfer', 'car_transfer_repair'],
  requests: ['quote_request', 'request_recipient', 'message'],
  settings: ['garage_feature', 'notification_preference', 'dashboard_layout'],
  team: ['garage_member', 'mechanic', 'staff_invite', 'mechanic_day_off'],
};

// Until the quotes and jobs modules can say who may see a driver's phone or
// plate, garage staff never get them from the history.
const SENSITIVE = new Set(['phone', 'plate']);
const MASK = '•••';

const sensitive = (name: string) => SENSITIVE.has(name.toLowerCase());

function maskInside(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskInside);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        sensitive(k) && v !== null ? MASK : maskInside(v),
      ]),
    );
  }
  return value;
}

const mask = (field: string | null, value: unknown) =>
  field && sensitive(field) && value !== null ? MASK : maskInside(value);

const invalid = (code: string, message: string) =>
  new BadRequestException({ code, message });

@Injectable()
export class AuditHistoryService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(
    actor: Actor,
    query: AuditHistoryQueryDto,
  ): Promise<AuditHistoryPageDto> {
    const admin = actor.role === 'admin';
    requireCapability(
      actor,
      admin ? 'admin.audit_history' : 'garage.audit_history',
    );
    // A UUID may arrive in capitals; PostgreSQL compares them without case.
    if (
      !admin &&
      query.garageId &&
      query.garageId.toLowerCase() !== actor.garageId?.toLowerCase()
    ) {
      throw new NotFoundException();
    }
    const scope: Prisma.ActivityLogWhereInput = admin
      ? {}
      : { garageId: actor.garageId };
    const where = { ...scope, ...this.filters(query) };
    if (query.garageId) where.garageId = query.garageId;

    if (
      query.cursor &&
      !(await this.prisma.activityLog.findFirst({
        select: { id: true },
        where: { ...scope, id: query.cursor },
      }))
    ) {
      throw invalid('invalid_cursor', 'cursor is not an entry of this history');
    }

    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: PAGE + 1,
        where,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      }),
      this.prisma.activityLog.count({ where }),
    ]);
    const page = rows.slice(0, PAGE);
    return {
      items: page.map((row) => this.entry(row, admin)),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
      total,
    };
  }

  private filters(query: AuditHistoryQueryDto): Prisma.ActivityLogWhereInput {
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : undefined;
    if (query.from && to && from > to) {
      throw invalid('validation_failed', 'from must not be after to');
    }
    const area = query.area;
    return {
      at: { gte: from, ...(to && { lte: to }) },
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.jobId && { jobId: query.jobId }),
      ...(area === 'admin_actions' && { actorRole: 'admin' }),
      ...(area &&
        area !== 'admin_actions' && { subjectType: { in: SUBJECTS[area] } }),
    };
  }

  private entry(row: ActivityLog, admin: boolean): AuditEntryDto {
    const value = (v: unknown) => (admin ? v : mask(row.field, v));
    return {
      action: row.action,
      actor: { id: row.actorId, name: row.actorName, role: row.actorRole },
      at: row.at.toISOString(),
      carId: row.carId,
      field: row.field,
      garageId: row.garageId,
      id: row.id,
      internal: row.internal,
      jobId: row.jobId,
      kind: row.kind,
      newValue: value(row.newValue),
      oldValue: value(row.oldValue),
      subjectId: row.subjectId,
      subjectType: row.subjectType,
      text: row.text,
      viaAssistant: row.viaAssistant,
    };
  }
}
