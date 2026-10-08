import { Injectable } from '@nestjs/common';

import type { AuditChange, AuditEntry, AuditPort } from './audit.port';
import { Prisma } from '../generated/prisma/client';

// The changes a driver's short history shows: price, time, stage, mechanic.
const KEY_CHANGES = new Set([
  'quote.from_bani',
  'quote.to_bani',
  'job.final_price_bani',
  'job.status',
  'job.eta_at',
  'booking.starts_at',
  'booking.mechanic_id',
  'booking.cancel_reason',
]);

// JSON with object keys sorted, so equal content compares equal whatever the key order.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

// As it was, through JSON: dates become UTC ISO strings; no value is SQL NULL.
const json = (value: unknown) =>
  value === undefined || value === null
    ? Prisma.DbNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

@Injectable()
export class AuditService implements AuditPort {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry) {
    await tx.activityLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId,
        actorName: await this.actorName(tx, entry),
        actorRole: entry.actorRole === 'garage' ? 'owner' : entry.actorRole,
        assistantGrantId: entry.assistantGrantId,
        carId: entry.carId,
        field: entry.field,
        garageId: entry.garageId,
        internal: entry.internal ?? false,
        isKeyChange: KEY_CHANGES.has(`${entry.subjectType}.${entry.field}`),
        jobId: entry.jobId,
        kind: entry.kind,
        newValue: json(entry.newValue),
        oldValue: json(entry.oldValue),
        subjectId: entry.subjectId,
        subjectType: entry.subjectType,
        text: entry.text,
        viaAssistant: entry.assistantGrantId !== undefined,
      },
    });
  }

  async recordChanges(
    tx: Prisma.TransactionClient,
    change: AuditChange,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    for (const [field, newValue] of Object.entries(after)) {
      const oldValue = Object.hasOwn(before, field) ? before[field] : null;
      if (canonical(oldValue) === canonical(newValue ?? null)) continue;
      await this.record(tx, {
        ...change,
        action: 'update',
        field,
        newValue,
        oldValue,
      });
    }
  }

  private async actorName(tx: Prisma.TransactionClient, entry: AuditEntry) {
    if (entry.actorRole === 'system') return 'MotorFix';
    if (entry.actorName !== undefined) return firstName(entry.actorName);
    if (!entry.actorId) return '';
    const account = await tx.account.findUnique({
      select: { name: true },
      where: { id: entry.actorId },
    });
    return account ? firstName(account.name) : '';
  }
}
