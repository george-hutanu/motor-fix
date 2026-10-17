import type { Params } from '@angular/router';
import {
  SYSTEM_LOG_PAGE_MAX,
  SYSTEM_LOG_RETENTION_DAYS,
  SYSTEM_LOG_SEARCH_MAX,
  SYSTEM_LOG_SEARCH_MIN,
  SYSTEM_LOG_SEVERITIES,
  SYSTEM_LOG_SOURCES,
  type SystemLogKind,
  type SystemLogSeverity,
  type SystemLogSource,
} from '@motor-fix/contracts/system-log';
import { bucharestDayStart } from '@motor-fix/i18n';

// The types an admin picks and the kinds each sends.
export const LOG_TYPES = {
  backup: ['backup_completed', 'backup_failed'],
  checks: ['check_failed'],
  deploy: ['deploy'],
  jobs: ['job_failed'],
  servers: ['server_error'],
  services: ['service_error'],
  status: ['status_changed'],
} as const satisfies Record<string, readonly SystemLogKind[]>;
export type LogType = keyof typeof LOG_TYPES;
// The pickers' order: the tiles' changes first, the routine kinds last.
export const LOG_TYPE_ORDER: readonly LogType[] = [
  'status',
  'checks',
  'jobs',
  'services',
  'servers',
  'backup',
  'deploy',
];

// What the view is narrowed to; days are Bucharest calendar days, `to`
// included, and an empty q is no search.
export interface LogFilter {
  from: string;
  to: string;
  type: LogType | null;
  severity: SystemLogSeverity | null;
  source: SystemLogSource | null;
  q: string;
}

// What the pickers and dates choose: the filter without its search.
export type LogChoice = Omit<LogFilter, 'q'>;

export interface LogQuery {
  from: string;
  to: string;
  limit: number;
  cursor?: string;
  kind?: SystemLogKind[];
  severity?: SystemLogSeverity[];
  source?: SystemLogSource[];
  q?: string;
}

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 6;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  CALENDAR_DAY.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);

const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);

// Midday sits inside the Bucharest day whatever the season.
const dayStart = (day: string) =>
  bucharestDayStart(new Date(`${day}T12:00:00.000Z`)).toISOString();

function bucharestDay(now: Date): string {
  return new Date(bucharestDayStart(now).getTime() + DAY_MS / 2)
    .toISOString()
    .slice(0, 10);
}

export function dayLimits(now: Date) {
  const max = bucharestDay(now);
  return { max, min: plusDays(max, -SYSTEM_LOG_RETENTION_DAYS) };
}

const defaultRange = (now: Date) => {
  const to = bucharestDay(now);
  return { from: plusDays(to, -DEFAULT_DAYS), to };
};

const isDefaultRange = (filter: LogFilter, now: Date) => {
  const range = defaultRange(now);
  return filter.from === range.from && filter.to === range.to;
};

const one = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value;

const within = (day: string, min: string, max: string) =>
  day < min ? min : day > max ? max : day;

function rangeOf(params: Params, now: Date) {
  const { max, min } = dayLimits(now);
  const rawFrom = one(params['from']);
  const rawTo = one(params['to']);
  const from = isDay(rawFrom) ? rawFrom : undefined;
  const to = isDay(rawTo) ? rawTo : undefined;
  let range = defaultRange(now);
  if (from && to) range = { from, to };
  else if (from) range = { from, to: max };
  else if (to) range = { from: plusDays(to, -DEFAULT_DAYS), to };
  range = {
    from: within(range.from, min, max),
    to: within(range.to, min, max),
  };
  if (range.to < range.from) range = { ...range, to: max };
  const rewrite =
    (rawFrom !== undefined || rawTo !== undefined) &&
    (range.from !== rawFrom || range.to !== rawTo);
  return { range, rewrite };
}

function choiceOf<T extends string>(
  params: Params,
  name: string,
  allowed: readonly T[],
): { value: T | null; rewrite: boolean } {
  const raw = params[name];
  if (raw === undefined) return { rewrite: false, value: null };
  const value = one(raw);
  const known = allowed.includes(value as T);
  return {
    rewrite: !known || Array.isArray(raw),
    value: known ? (value as T) : null,
  };
}

function searchOf(params: Params) {
  const raw = one(params['q']);
  if (typeof raw !== 'string') return { rewrite: raw !== undefined, value: '' };
  const cut = raw.trim().slice(0, SYSTEM_LOG_SEARCH_MAX);
  const value = cut.length >= SYSTEM_LOG_SEARCH_MIN ? cut : '';
  return { rewrite: value !== raw, value };
}

// The filter an address asks for, and whether the address must be rewritten
// because something in it was dropped, cut or defaulted.
export function filterOf(
  params: Params,
  now: Date,
): { filter: LogFilter; rewrite: boolean } {
  const { range, rewrite } = rangeOf(params, now);
  const type = choiceOf(params, 'kind', LOG_TYPE_ORDER);
  const severity = choiceOf(params, 'severity', SYSTEM_LOG_SEVERITIES);
  const source = choiceOf(params, 'source', SYSTEM_LOG_SOURCES);
  const q = searchOf(params);
  return {
    filter: {
      ...range,
      q: q.value,
      severity: severity.value,
      source: source.value,
      type: type.value,
    },
    rewrite:
      rewrite ||
      type.rewrite ||
      severity.rewrite ||
      source.rewrite ||
      q.rewrite,
  };
}

// The address of a filter: nothing for the defaults, both days for any
// other range.
export function paramsOf(filter: LogFilter, now: Date) {
  const range = isDefaultRange(filter, now);
  return {
    from: range ? null : filter.from,
    kind: filter.type,
    q: filter.q || null,
    severity: filter.severity,
    source: filter.source,
    to: range ? null : filter.to,
  };
}

export function queryOf(filter: LogFilter, cursor?: string): LogQuery {
  return {
    from: dayStart(filter.from),
    limit: SYSTEM_LOG_PAGE_MAX,
    to: dayStart(plusDays(filter.to, 1)),
    ...(cursor && { cursor }),
    ...(filter.type && { kind: [...LOG_TYPES[filter.type]] }),
    ...(filter.severity && { severity: [filter.severity] }),
    ...(filter.source && { source: [filter.source] }),
    ...(filter.q && { q: filter.q }),
  };
}

export interface RangeFault {
  field: 'from' | 'to';
  key: string;
}

const fault = (field: RangeFault['field'], reason: string): RangeFault => ({
  field,
  key: `admin.log.view.dates.${reason}`,
});

// The input at fault in a range the date inputs hold, or undefined.
export function rangeFault(
  range: { from: string; to: string },
  now: Date,
): RangeFault | undefined {
  const { max, min } = dayLimits(now);
  if (!isDay(range.from)) return fault('from', 'missing');
  if (!isDay(range.to)) return fault('to', 'missing');
  if (range.from > max) return fault('from', 'future');
  if (range.to > max) return fault('to', 'future');
  if (range.from < min) return fault('from', 'tooOld');
  if (range.to < range.from) return fault('to', 'beforeFrom');
  return undefined;
}

export function filtersSet(filter: LogFilter, now: Date): number {
  return (
    [filter.type, filter.severity, filter.source].filter(Boolean).length +
    (isDefaultRange(filter, now) ? 0 : 1)
  );
}

export const includesToday = (filter: LogFilter, now: Date) =>
  filter.to === bucharestDay(now);

export function passes(
  filter: LogFilter,
  entry: {
    entryKind: SystemLogKind;
    severity: SystemLogSeverity;
    source: SystemLogSource;
  },
): boolean {
  return (
    (!filter.type ||
      (LOG_TYPES[filter.type] as readonly string[]).includes(
        entry.entryKind,
      )) &&
    (!filter.severity || filter.severity === entry.severity) &&
    (!filter.source || filter.source === entry.source)
  );
}
