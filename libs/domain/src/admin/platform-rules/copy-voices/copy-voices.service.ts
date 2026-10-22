import type {
  ChangeCopyVoiceDto,
  CopyVoicesDto,
  PublicCopyVoicesDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { recordVoiceChange, type VoiceChange } from './copy-voices.metrics';
import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  CopyVoiceSetting,
  Prisma,
  PrismaClient,
} from '../../../generated/prisma/client';

type State = { enabled: boolean; pinned: boolean };
type Changed = { voice: number; before: State; after: State };

const state = ({ enabled, pinned }: State): State => ({ enabled, pinned });
const same = (a: State, b: State) =>
  a.enabled === b.enabled && a.pinned === b.pinned;

const publicOf = (rows: CopyVoiceSetting[]): PublicCopyVoicesDto => ({
  enabled: rows.filter((r) => r.enabled).map((r) => r.voice),
  pinned: rows.find((r) => r.pinned)?.voice ?? null,
});

const COUNT_WINDOW_MS = 30 * 86_400_000;

type Tally = { copyVoice: number | null; _count: { _all: number } };

const tallyOf = (groups: Tally[], voice: number) =>
  groups.find((g) => g.copyVoice === voice)?._count._all ?? 0;

const listOf = (
  rows: CopyVoiceSetting[],
  requests: Tally[],
  listings: Tally[],
): CopyVoicesDto => ({
  voices: rows.map((r) => ({
    enabled: r.enabled,
    listings: tallyOf(listings, r.voice),
    pinned: r.pinned,
    requests: tallyOf(requests, r.voice),
    updatedAt: r.updatedAt?.toISOString() ?? null,
    voice: r.voice,
  })),
});

const stale = () =>
  refusal(
    HttpStatus.CONFLICT,
    'stale_value',
    'The voice changed since it was read',
  );

// After the stale check and the no-change answer: at least one voice on, the
// pinned voice on.
function refuseRules(row: State, wanted: State, after: State[]) {
  if (!after.some((r) => r.enabled)) {
    return refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'last_voice',
      'At least one voice stays on',
    );
  }
  if (row.pinned && !wanted.enabled) {
    return refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'voice_pinned',
      'The pinned voice cannot be switched off',
    );
  }
  if (wanted.pinned && !wanted.enabled) {
    return refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'voice_off',
      'A voice that is off cannot be pinned',
    );
  }
  return undefined;
}

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such voice');

function changesOf(before: State, after: State): VoiceChange[] {
  const out: VoiceChange[] = [];
  if (before.enabled !== after.enabled) {
    out.push(after.enabled ? 'enabled' : 'disabled');
  }
  if (before.pinned !== after.pinned) {
    out.push(after.pinned ? 'pinned' : 'unpinned');
  }
  return out;
}

@Injectable()
export class CopyVoicesService {
  private readonly logger = new Logger('CopyVoices');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async settings(): Promise<PublicCopyVoicesDto> {
    return publicOf(await this.rows(this.prisma));
  }

  async list(actor: Actor): Promise<CopyVoicesDto> {
    requireCapability(actor, 'admin.settings');
    return this.withCounts(await this.rows(this.prisma));
  }

  async change(
    actor: Actor,
    voice: number,
    { enabled, pinned, seen }: ChangeCopyVoiceDto,
  ): Promise<CopyVoicesDto> {
    requireCapability(actor, 'admin.settings');
    if (!Number.isInteger(voice) || voice < 1 || voice > 5) throw notFound();
    const wanted = { enabled, pinned };
    let changed: Changed[] = [];
    const rows = await this.prisma.$transaction(async (tx) => {
      // All five, so two changes that move the pin or switch off the last
      // voices wait for each other.
      await tx.$queryRaw`
        SELECT id FROM copy_voice_setting ORDER BY voice FOR UPDATE`;
      const before = await this.rows(tx);
      const row = before.find((r) => r.voice === voice);
      if (!row) throw notFound();
      if (!same(seen, row)) throw stale();
      if (same(wanted, row)) return before;
      const after = before.map((r) =>
        r.voice === voice
          ? { ...r, ...wanted }
          : { ...r, pinned: wanted.pinned ? false : r.pinned },
      );
      const refused = refuseRules(row, wanted, after);
      if (refused) throw refused;
      changed = await this.save(tx, actor, before, after);
      return this.rows(tx);
    });
    for (const c of changed) {
      for (const kind of changesOf(c.before, c.after)) recordVoiceChange(kind);
      this.logger.log(
        `voice ${c.voice} ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)} by ${actor.accountId}`,
      );
    }
    return this.withCounts(rows);
  }

  // The requests sent and the listing drafts started in each voice over the
  // last 30 days, whatever became of them since.
  private async withCounts(rows: CopyVoiceSetting[]): Promise<CopyVoicesDto> {
    const where = {
      copyVoice: { not: null },
      createdAt: { gte: new Date(Date.now() - COUNT_WINDOW_MS) },
    };
    const [requests, listings] = await Promise.all([
      this.prisma.quoteRequest.groupBy({
        _count: { _all: true },
        by: ['copyVoice'],
        where,
      }),
      this.prisma.listingDraft.groupBy({
        _count: { _all: true },
        by: ['copyVoice'],
        where,
      }),
    ]);
    return listOf(rows, requests, listings);
  }

  // Each changed row with its audit entry, then one event for the change.
  private async save(
    tx: Prisma.TransactionClient,
    actor: Actor,
    before: CopyVoiceSetting[],
    after: CopyVoiceSetting[],
  ): Promise<Changed[]> {
    const now = new Date();
    const changed: Changed[] = [];
    for (const [i, next] of after.entries()) {
      const was = state(before[i]);
      if (same(next, was)) continue;
      await tx.copyVoiceSetting.update({
        data: { ...state(next), updatedAt: now, updatedBy: actor.accountId },
        where: { id: next.id },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: String(next.voice),
        kind: 'copy_voice_changed',
        newValue: state(next),
        oldValue: was,
        subjectId: next.id,
        subjectType: 'copy_voice',
      });
      changed.push({ after: state(next), before: was, voice: next.voice });
    }
    await this.events.record(tx, {
      audience: { type: 'platform' },
      kind: 'platform_rule.changed',
      payload: {
        key: 'copy_voices',
        new: publicOf(after),
        old: publicOf(before),
      },
      subjectId: 'copy_voices',
    });
    return changed;
  }

  private rows(db: Pick<PrismaClient, 'copyVoiceSetting'>) {
    return db.copyVoiceSetting.findMany({ orderBy: { voice: 'asc' } });
  }
}
