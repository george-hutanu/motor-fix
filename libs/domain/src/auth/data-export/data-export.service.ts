import type { DataExportDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { DataExport, PrismaClient } from '../../generated/prisma/client';
import {
  countDataExport,
  type DataExportOutcome,
} from '../../metrics/product-counters';
import { StorageService } from '../../storage/storage.service';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';
import { refusal, taken } from '../sign-up.service';

// One request a day; a failed export does not count.
export const REQUEST_GAP_MS = 24 * 60 * 60_000;

export interface DataExportFile {
  body: Buffer;
  filename: string;
}

const newestCounted = (accountId: string) => ({
  orderBy: { requestedAt: 'desc' as const },
  where: { accountId, status: { not: 'failed' as const } },
});

const dtoOf = (row: DataExport, counted: DataExport | null): DataExportDto => {
  const allowedAt = counted
    ? counted.requestedAt.getTime() + REQUEST_GAP_MS
    : 0;
  return {
    canRequestAt:
      allowedAt > Date.now() ? new Date(allowedAt).toISOString() : null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    readyAt: row.readyAt?.toISOString() ?? null,
    requestedAt: row.requestedAt.toISOString(),
    status: row.status,
  };
};

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No export ready to download');

// A person asks for a copy of their data, reads where it stands and
// downloads it while it is ready. The worker builds and expires it.
@Injectable()
export class DataExportService {
  private readonly logger = new Logger('DataExport');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly storage: StorageService,
  ) {}

  async request(actor: Actor): Promise<DataExportDto> {
    this.personally(actor, 'An assistant cannot ask for a copy of the data');
    const { accountId } = actor;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const newest = await tx.dataExport.findFirst(newestCounted(accountId));
        if (newest?.status === 'ready') {
          throw this.refused(
            'already_ready',
            HttpStatus.CONFLICT,
            'export_ready',
            'A copy is ready to download',
          );
        }
        if (
          newest &&
          newest.requestedAt.getTime() > Date.now() - REQUEST_GAP_MS
        ) {
          throw this.tooSoon();
        }
        const created = await tx.dataExport.create({ data: { accountId } });
        await this.audit.record(tx, {
          action: 'create',
          actorId: accountId,
          actorRole: actor.role,
          kind: 'data_export_requested',
          subjectId: accountId,
          subjectType: 'account',
        });
        await this.events.record(tx, {
          audience: { accountId, type: 'account' },
          kind: 'data_export.requested',
          payload: { accountId, exportId: created.id },
          subjectId: created.id,
        });
        return created;
      });
      countDataExport('requested');
      this.logger.log(`data export requested ${row.id}`);
      return dtoOf(row, row);
    } catch (error) {
      // The loser of two requests sent at once meets the one queued export.
      if (taken(error)) throw this.tooSoon();
      throw error;
    }
  }

  async latest(actor: Actor): Promise<DataExportDto | null> {
    this.personally(actor, 'An assistant cannot read the copy of the data');
    const [newest, counted] = await Promise.all([
      this.prisma.dataExport.findFirst({
        orderBy: { requestedAt: 'desc' },
        where: { accountId: actor.accountId },
      }),
      this.prisma.dataExport.findFirst(newestCounted(actor.accountId)),
    ]);
    return newest ? dtoOf(newest, counted) : null;
  }

  async download(actor: Actor): Promise<DataExportFile> {
    this.personally(actor, 'An assistant cannot download the copy of the data');
    const row = await this.prisma.dataExport.findFirst({
      orderBy: { requestedAt: 'desc' },
      where: { accountId: actor.accountId, status: 'ready' },
    });
    if (!row?.zipKey || !row.readyAt) throw notFound();
    const stored = await this.storage.readStored(row.zipKey).catch(() => {
      throw refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        'storage_unavailable',
        'The file store did not answer',
      );
    });
    if (!stored) throw notFound();
    countDataExport('downloaded');
    this.logger.log(`data export downloaded ${row.id}`);
    const day = row.readyAt.toISOString().slice(0, 10);
    return { body: stored.body, filename: `motorfix-date-${day}.zip` };
  }

  private personally(actor: Actor, message: string) {
    if (actor.via === 'assistant') {
      throw this.refused(
        'forbidden',
        HttpStatus.FORBIDDEN,
        'forbidden',
        message,
      );
    }
  }

  private tooSoon() {
    return this.refused(
      'too_soon',
      HttpStatus.TOO_MANY_REQUESTS,
      'export_too_soon',
      'A new copy can be asked for once a day',
    );
  }

  private refused(
    outcome: DataExportOutcome,
    status: HttpStatus,
    code: string,
    message: string,
  ) {
    countDataExport(outcome);
    this.logger.warn(`data export refused: ${outcome}`);
    return refusal(status, code, message);
  }
}
