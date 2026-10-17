import type { Figures, TileKey, TileState } from '../../status/tiles';

export const KINDS = [
  'status_changed',
  'check_failed',
  'job_failed',
  'service_error',
  'server_error',
  'backup_completed',
  'backup_failed',
  'deploy',
] as const;
export type Kind = (typeof KINDS)[number];

export const SOURCES = [
  'api',
  'search',
  'maps',
  'email',
  'notifications',
  'backup',
  'worker',
  'webrtc',
  'identity',
  'storage',
] as const;
export type Source = (typeof SOURCES)[number];

type Severity = 'info' | 'warning' | 'error';

// What each kind carries: ids, codes and figures, never free text.
export interface Contexts {
  status_changed: {
    state: TileState;
    figure?: keyof Figures;
    limit?: number;
    reason?: string;
    [detail: string]: string | number | undefined;
  };
  check_failed: { reason: string };
  job_failed: {
    queue: string;
    job: string;
    attempts: number;
    error_code: string;
  };
  service_error:
    | { provider: string; status: number }
    | { provider: string; reason: string };
  server_error: { method: string; route: string };
  backup_completed: { backup_at: string };
  backup_failed: { last_backup_at: string; reason: string };
  deploy: { version: string };
}

export interface Entry {
  severity: Severity;
  fingerprint: string;
  message: string;
}

const TILE_NAMES: Record<TileKey, string> = {
  api: 'API',
  backup: 'Backup',
  email: 'E-mail',
  maps: 'Maps',
  notifications: 'Notifications',
  search: 'Search',
};

const FIGURE_NAMES: Record<keyof Figures, string> = {
  backup_age_h: 'backup age',
  failed_share: 'failed sends',
  latency_ms: 'response time',
  oldest_waiting_s: 'oldest waiting job',
};

const trim = (value: number) => String(Math.round(value * 10) / 10);

const LIMIT_UNITS: Record<keyof Figures, (value: number) => string> = {
  backup_age_h: (h) => `${trim(h)} h`,
  failed_share: (share) => `${trim(share * 100)} %`,
  latency_ms: (ms) => (ms >= 1000 ? `${trim(ms / 1000)} s` : `${trim(ms)} ms`),
  oldest_waiting_s: (s) => (s >= 60 ? `${trim(s / 60)} min` : `${trim(s)} s`),
};

const tileName = (source: Source) => TILE_NAMES[source as TileKey] ?? source;

const capitalised = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1);

function tileChange(source: Source, c: Contexts['status_changed']): string {
  const tile = tileName(source);
  if (c.state === 'green') return `${tile}: back to normal.`;
  if (c.figure && c.limit !== undefined) {
    return `${tile}: ${FIGURE_NAMES[c.figure]} went above ${LIMIT_UNITS[c.figure](c.limit)}.`;
  }
  return c.reason === undefined
    ? `${tile}: turned ${c.state}.`
    : `${tile}: turned ${c.state} (${c.reason}).`;
}

const answer = (c: Contexts['service_error']) =>
  'status' in c ? String(c.status) : c.reason;

type Derive<K extends Kind> = (
  c: Contexts[K],
  source: Source,
  at: Date,
) => Entry;

// The one place an entry's severity, grouping key and English message come
// from.
const DERIVE: { [K in Kind]: Derive<K> } = {
  backup_completed: (c) => ({
    fingerprint: c.backup_at,
    message: `Backup completed at ${c.backup_at}.`,
    severity: 'info',
  }),
  backup_failed: (c, _, at) => ({
    fingerprint: at.toISOString().slice(0, 10),
    message: `No backup since ${c.last_backup_at}.`,
    severity: 'error',
  }),
  check_failed: (c, source) => ({
    fingerprint: c.reason,
    message: `${tileName(source)}: check failed (${c.reason}).`,
    severity: 'warning',
  }),
  deploy: (c) => ({
    fingerprint: c.version,
    message: `Deployed ${c.version}.`,
    severity: 'info',
  }),
  job_failed: (c) => ({
    fingerprint: `${c.queue}:${c.job}:${c.error_code}`,
    message: `Job ${c.job} on ${c.queue} failed for good after ${c.attempts} attempts (${c.error_code}).`,
    severity: 'error',
  }),
  server_error: (c) => ({
    fingerprint: c.route === 'unknown' ? 'unknown' : `${c.method} ${c.route}`,
    message: `Unexpected error on ${c.method} ${c.route}.`,
    severity: 'error',
  }),
  service_error: (c) => ({
    fingerprint: `${c.provider}:${answer(c)}`,
    message: `${capitalised(c.provider)} answered ${answer(c)}.`,
    severity: 'error',
  }),
  status_changed: (c, source) => ({
    fingerprint: c.state,
    message: tileChange(source, c),
    severity: c.state === 'green' ? 'info' : 'warning',
  }),
};

// The kind and source are checked against the lists by the writer, once.
export function entryOf<K extends Kind>(
  kind: K,
  source: Source,
  context: Contexts[K],
  at: Date,
): Entry {
  return (DERIVE[kind] as Derive<K>)(context, source, at);
}

export function minuteOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}
