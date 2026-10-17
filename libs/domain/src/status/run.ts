import type { Queue } from 'bullmq';

import { dueTiles, type Outcome, type ProbeDeps, probe } from './probes/probes';
import { medianLatency, recordSample, type SampleStore } from './samples';
import type { Thresholds } from './thresholds';
import {
  type Check,
  type Detail,
  type Figures,
  limitCrossed,
  nextTile,
  stateOf,
  type TileKey,
  type TileRow,
  type TileState,
} from './tiles';
import { systemLog } from '../admin/system-log/system-log';
import type { EventPort } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';
import { Brevo } from '../notifications/brevo/brevo';
import { type PlacesConfig, providerFor } from '../places/places.module';

export interface RunOptions {
  // The public web address the api and search probes call.
  webUrl: string | undefined;
  brevo: { apiKey: string | undefined; apiUrl: string };
  places: PlacesConfig;
  backup: ProbeDeps['backup'];
}

interface RunDeps {
  prisma: PrismaClient;
  events: EventPort;
  probes: ProbeDeps;
  samples: SampleStore;
  thresholds: Thresholds;
}

interface Change {
  tile: TileKey;
  state: TileState;
  detail: Detail;
}

export function liveProbes(
  options: RunOptions,
  prisma: PrismaClient,
  notifications: Queue,
): ProbeDeps {
  const { apiKey, apiUrl } = options.brevo;
  return {
    backup: options.backup,
    brevo: apiKey ? new Brevo({ apiKey, apiUrl }) : undefined,
    clock: () => performance.now(),
    fetch,
    now: () => new Date(),
    oldestWaiting: async () => {
      const [job] = await notifications.getWaiting(0, 0);
      return job?.timestamp ?? null;
    },
    places: providerFor(options.places),
    sends: async (channels, since) => {
      const counts = await prisma.notification.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: {
          channel: { in: [...channels] },
          createdAt: { gte: since },
          status: { in: ['sent', 'failed'] },
        },
      });
      const count = (status: string) =>
        counts.find((row) => row.status === status)?._count._all ?? 0;
      return { failed: count('failed'), sent: count('sent') };
    },
    webUrl:
      options.webUrl && URL.canParse(options.webUrl)
        ? new URL(options.webUrl)
        : undefined,
  };
}

// The latency judged is the median of the last five minutes; with the store
// down, the current sample stands alone.
async function latency(
  deps: RunDeps,
  tile: TileKey,
  sample: number,
  now: Date,
): Promise<number> {
  try {
    await recordSample(deps.samples, tile, sample, now);
    return (await medianLatency(deps.samples, tile, now)) ?? sample;
  } catch {
    return sample;
  }
}

// A check, and the figures it was judged on (null for a failed check).
interface Judged extends Check {
  figures: Figures | null;
}

async function judge(
  deps: RunDeps,
  tile: TileKey,
  outcome: Outcome,
  now: Date,
): Promise<Judged> {
  const limits = deps.thresholds[tile];
  if (!outcome.ok) {
    return {
      detail: { reason: outcome.reason },
      figures: null,
      state: stateOf(null, limits),
    };
  }
  const figures = { ...outcome.figures };
  if (outcome.latencyMs !== undefined) {
    figures.latency_ms = await latency(deps, tile, outcome.latencyMs, now);
  }
  const { backup_age_h: _, ...shown } = figures;
  return {
    detail: { ...shown, ...outcome.detail },
    figures,
    state: stateOf(figures, limits),
  };
}

interface Judgement {
  changed: boolean;
  first: boolean;
  row: TileRow;
  check: Judged;
  outcome: Outcome;
}

// The newest backup the log already holds as completed, if any.
async function lastCompleted(prisma: PrismaClient): Promise<number | null> {
  const entry = await prisma.systemLogEntry
    .findFirst({ orderBy: { at: 'desc' }, where: { kind: 'backup_completed' } })
    .catch(() => null);
  const at = (entry?.context as { backup_at?: string } | null)?.backup_at;
  return at ? Date.parse(at) : null;
}

async function writeBackup(
  deps: RunDeps,
  { changed, row }: Judgement,
  now: Date,
): Promise<void> {
  const last = row.detail['last_backup_at'];
  if (typeof last !== 'string') return;
  const logged = await lastCompleted(deps.prisma);
  if (logged === null || Date.parse(last) > logged) {
    await systemLog.write(
      'backup_completed',
      'backup',
      { backup_at: last },
      now,
    );
  }
  if (changed && row.state !== 'green') {
    await systemLog.write(
      'backup_failed',
      'backup',
      { last_backup_at: last, reason: 'too_old' },
      now,
    );
  }
}

// What a run leaves in the system status log once its tiles are stored: a
// failed check each time, a tile's confirmed change (a first sight only when
// it is not green), a backup newer than the last one logged, and a backup
// that has turned late.
async function writeLog(
  deps: RunDeps,
  judged: Judgement[],
  now: Date,
): Promise<void> {
  for (const judgement of judged) {
    const { changed, check, first, outcome, row } = judgement;
    if (changed && !(first && row.state === 'green')) {
      const crossed = limitCrossed(
        check.figures,
        deps.thresholds[row.key],
        row.state,
      );
      await systemLog.write(
        'status_changed',
        row.key,
        { ...row.detail, ...crossed, state: row.state },
        now,
      );
    }
    if (!outcome.ok) {
      await systemLog.write(
        'check_failed',
        row.key,
        { reason: outcome.reason },
        now,
      );
    } else if (row.key === 'backup') {
      await writeBackup(deps, judgement, now);
    }
  }
}

// One run: every due tile probed apart, then every row and its event written
// in one transaction.
export async function runChecks(deps: RunDeps): Promise<Change[]> {
  const now = deps.probes.now();
  const stored = new Map(
    (await deps.prisma.statusTile.findMany()).map((row) => [
      row.key,
      { ...row, detail: row.detail as Detail } satisfies TileRow,
    ]),
  );
  const tiles = dueTiles(stored.get('maps') ?? null, now);
  const outcomes = await Promise.all(
    tiles.map((tile) => probe(tile, deps.probes)),
  );
  const next: Judgement[] = await Promise.all(
    tiles.map(async (tile, n) => {
      const outcome = outcomes[n] as Outcome;
      const check = await judge(deps, tile, outcome, now);
      const { figures: _, ...judged } = check;
      const previous = stored.get(tile) ?? null;
      return {
        ...nextTile(tile, previous, judged, now),
        check,
        first: previous === null,
        outcome,
      };
    }),
  );
  await deps.prisma.$transaction(async (tx) => {
    for (const { changed, row } of next) {
      await tx.statusTile.upsert({
        create: row,
        update: row,
        where: { key: row.key },
      });
      if (!changed) continue;
      await deps.events.record(tx, {
        audience: { adminOnly: true, type: 'platform' },
        kind: 'status_tile.changed',
        payload: {
          since: row.since.toISOString(),
          state: row.state,
          tile: row.key,
        },
        subjectId: row.key,
      });
    }
  });
  await writeLog(deps, next, now);
  return next
    .filter(({ changed }) => changed)
    .map(({ row }) => ({
      detail: row.detail,
      state: row.state,
      tile: row.key,
    }));
}
