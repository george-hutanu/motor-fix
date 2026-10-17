import {
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';

import type { PlacesProvider } from '../../places/providers/places.provider';
import { type Detail, type Figures, TILES, type TileKey } from '../tiles';

type Channel = 'email' | 'push' | 'sms' | 'whatsapp';

export interface ProbeDeps {
  webUrl: URL | undefined;
  fetch: typeof fetch;
  places: PlacesProvider;
  brevo: { checkKey(signal: AbortSignal): Promise<boolean> } | undefined;
  // Sent and failed notifications of these channels created since then.
  sends(
    channels: readonly Channel[],
    since: Date,
  ): Promise<{ sent: number; failed: number }>;
  // When the oldest waiting notification job was added, in ms; null if none.
  oldestWaiting(): Promise<number | null>;
  // The newest backup manifest's time; null on an empty bucket. Unset when
  // the bucket's settings are.
  backup: ((signal: AbortSignal) => Promise<Date | null>) | undefined;
  // A monotonic clock in ms, for the latencies.
  clock(): number;
  now(): Date;
}

export type Outcome =
  | { ok: true; figures: Figures; latencyMs?: number; detail?: Detail }
  | { ok: false; reason: string };

const TIMEOUT_MS = 10_000;
const SHARE_WINDOW_MS = 15 * 60_000;
// Seen 30 s apart on a 30 s schedule, the maps tile is probed every other run.
const MAPS_EVERY_MS = 55_000;
const MAPS_QUERY = 'Piața Unirii, București';
const BUCHAREST_CENTRE = '44.4268,26.1025';

const timed = async (deps: ProbeDeps, call: () => Promise<void>) => {
  const started = deps.clock();
  await call();
  return Math.round(deps.clock() - started);
};

const get = async (deps: ProbeDeps, path: string, signal: AbortSignal) => {
  if (!deps.webUrl) throw new Error('not_configured');
  const res = await deps.fetch(new URL(path, deps.webUrl), { signal });
  if (res.status !== 200) throw new Error(`http_${res.status}`);
  return res;
};

const share = ({ failed, sent }: { failed: number; sent: number }) =>
  failed + sent ? failed / (failed + sent) : 0;

const since = (deps: ProbeDeps) =>
  new Date(deps.now().getTime() - SHARE_WINDOW_MS);

const PROBES: Record<
  TileKey,
  (deps: ProbeDeps, signal: AbortSignal) => Promise<Outcome>
> = {
  api: async (deps, signal) => ({
    figures: {},
    latencyMs: await timed(deps, async () => {
      await get(deps, '/health/ready', signal);
    }),
    ok: true,
  }),
  backup: async (deps, signal) => {
    if (!deps.backup) throw new Error('not_configured');
    const last = await deps.backup(signal);
    if (!last) throw new Error('no_backup');
    return {
      detail: { last_backup_at: last.toISOString() },
      figures: {
        backup_age_h: (deps.now().getTime() - last.getTime()) / 3_600_000,
      },
      ok: true,
    };
  },
  email: async (deps, signal) => {
    const brevo = deps.brevo;
    if (!brevo) throw new Error('not_configured');
    const latencyMs = await timed(deps, async () => {
      if (!(await brevo.checkKey(signal))) throw new Error('provider_refused');
    });
    const counts = await deps.sends(['email'], since(deps));
    return { figures: { failed_share: share(counts) }, latencyMs, ok: true };
  },
  maps: async (deps, signal) => ({
    figures: {},
    latencyMs: await timed(deps, async () => {
      const answer = await deps.places.search(MAPS_QUERY, 'ro', signal);
      if ('unavailable' in answer) throw new Error(answer.unavailable);
    }),
    ok: true,
  }),
  notifications: async (deps) => {
    const oldest = await deps.oldestWaiting();
    const counts = await deps.sends(['push', 'sms', 'whatsapp'], since(deps));
    return {
      figures: {
        failed_share: share(counts),
        oldest_waiting_s:
          oldest === null
            ? 0
            : Math.max(0, Math.round((deps.now().getTime() - oldest) / 1000)),
      },
      ok: true,
    };
  },
  // The figure is the garage search's time alone; the brand it searches for
  // is looked up first, untimed. Without the log flag the search writes no
  // search log row.
  search: async (deps, signal) => {
    const brands: unknown = await (
      await get(deps, '/api/v1/brands/popular?limit=1', signal)
    ).json();
    const slug = Array.isArray(brands)
      ? (brands[0] as { slug?: unknown } | undefined)?.slug
      : undefined;
    if (typeof slug !== 'string' || !slug) throw new Error('no_brand');
    const query = new URLSearchParams({ brand: slug, near: BUCHAREST_CENTRE });
    return {
      figures: {},
      latencyMs: await timed(deps, async () => {
        await get(deps, `/api/v1/search/garages?${query}`, signal);
      }),
      ok: true,
    };
  },
};

// Never rejects: a throw or a probe past 10 s is a failed check.
export async function probe(tile: TileKey, deps: ProbeDeps): Promise<Outcome> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve({ ok: false, reason: 'timeout' });
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([PROBES[tile](deps, abort.signal), timeout]);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 200) : 'failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

// The tiles this run probes: maps only when its last check is old enough.
export function dueTiles(
  maps: { checkedAt: Date } | null,
  now: Date,
): TileKey[] {
  const mapsDue =
    !maps || now.getTime() - maps.checkedAt.getTime() >= MAPS_EVERY_MS;
  return mapsDue ? [...TILES] : TILES.filter((tile) => tile !== 'maps');
}

export function newestManifest(
  contents: ListObjectsV2CommandOutput['Contents'],
): Date | null {
  let newest: Date | null = null;
  for (const { Key, LastModified } of contents ?? []) {
    if (!Key?.endsWith('.manifest.json')) continue;
    if (!LastModified || Number.isNaN(LastModified.getTime())) continue;
    if (!newest || LastModified > newest) newest = LastModified;
  }
  return newest;
}

export interface BackupLister {
  list: NonNullable<ProbeDeps['backup']>;
  destroy(): void;
}

// The nightly backup bucket, read with its own settings: the copies of this
// environment sit under `<environment>/`. One page of 1000 keys holds them
// all, as the bucket keeps 30 days of nightly copies.
export function backupLister(
  appEnv: string,
  source: Record<string, string | undefined>,
): BackupLister | undefined {
  const endpoint = source['BACKUP_S3_ENDPOINT'];
  const region = source['BACKUP_S3_REGION'];
  const bucket = source['BACKUP_S3_BUCKET'];
  const accessKeyId = source['BACKUP_S3_ACCESS_KEY_ID'];
  const secretAccessKey = source['BACKUP_S3_SECRET_ACCESS_KEY'];
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  const s3 = new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    forcePathStyle: true,
    region,
    requestHandler: { connectionTimeout: 2000, requestTimeout: TIMEOUT_MS },
  });
  return {
    destroy: () => s3.destroy(),
    list: async (abortSignal) => {
      const page = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: `${appEnv}/` }),
        { abortSignal },
      );
      return newestManifest(page.Contents);
    },
  };
}
