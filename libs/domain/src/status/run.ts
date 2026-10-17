import type { Queue } from 'bullmq';

import { dueTiles, type Outcome, type ProbeDeps, probe } from './probes/probes';
import { medianLatency, recordSample, type SampleStore } from './samples';
import type { Thresholds } from './thresholds';
import {
  type Check,
  type Detail,
  nextTile,
  stateOf,
  type TileKey,
  type TileRow,
  type TileState,
} from './tiles';
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

export interface RunDeps {
  prisma: PrismaClient;
  events: EventPort;
  probes: ProbeDeps;
  samples: SampleStore;
  thresholds: Thresholds;
}

export interface Change {
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
    fetch: (input, init) => fetch(input, init),
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

async function judge(
  deps: RunDeps,
  tile: TileKey,
  outcome: Outcome,
  now: Date,
): Promise<Check> {
  const limits = deps.thresholds[tile];
  if (!outcome.ok) {
    return { detail: { reason: outcome.reason }, state: stateOf(null, limits) };
  }
  const figures = { ...outcome.figures };
  if (outcome.latencyMs !== undefined) {
    figures.latency_ms = await latency(deps, tile, outcome.latencyMs, now);
  }
  const { backup_age_h: _, ...shown } = figures;
  return {
    detail: { ...shown, ...outcome.detail },
    state: stateOf(figures, limits),
  };
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
  const next = await Promise.all(
    tiles.map(async (tile, n) =>
      nextTile(
        tile,
        stored.get(tile) ?? null,
        await judge(deps, tile, outcomes[n] as Outcome, now),
        now,
      ),
    ),
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
  return next
    .filter(({ changed }) => changed)
    .map(({ row }) => ({
      detail: row.detail,
      state: row.state,
      tile: row.key,
    }));
}
