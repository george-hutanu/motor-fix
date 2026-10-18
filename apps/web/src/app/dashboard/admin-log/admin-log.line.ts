import type { SystemLogEntryDto } from '@motor-fix/data-access';
import {
  formatClock,
  formatDay,
  formatNum,
  type I18n,
  type Language,
} from '@motor-fix/i18n';
import type { LampState } from '@motor-fix/ui-cockpit';

type Context = Record<string, unknown>;

const FIGURES = [
  'backup_age_h',
  'failed_share',
  'latency_ms',
  'oldest_waiting_s',
] as const;
type Figure = (typeof FIGURES)[number];
const STATES: readonly unknown[] = ['green', 'amber', 'red'];

const trim = (value: number) => Math.round(value * 10) / 10;

// The units the writer uses for each limit, the number in the language.
const LIMITS: Record<Figure, (value: number) => [number, string]> = {
  backup_age_h: (h) => [trim(h), 'h'],
  failed_share: (share) => [trim(share * 100), '%'],
  latency_ms: (ms) => (ms >= 1000 ? [trim(ms / 1000), 's'] : [trim(ms), 'ms']),
  oldest_waiting_s: (s) => (s >= 60 ? [trim(s / 60), 'min'] : [trim(s), 's']),
};

const text = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const capitalised = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1);

// A sentence's parts, or undefined when the context lacks one: the line then
// shows the stored English message.
type Parts = [key: string, params: Record<string, string | number>];

function tileChange(c: Context, source: string): Parts | undefined {
  if (!STATES.includes(c['state'])) return undefined;
  const state = c['state'] as string;
  if (state === 'green') return ['kind.status_changed.green', { source }];
  if (c['figure'] !== undefined || c['limit'] !== undefined) {
    const figure = c['figure'] as Figure;
    if (!FIGURES.includes(figure) || !number(c['limit'])) return undefined;
    return ['kind.status_changed.limit', { figure, limit: c['limit'], source }];
  }
  return text(c['reason'])
    ? [
        'kind.status_changed.turnedReason',
        { reason: c['reason'], source, state },
      ]
    : ['kind.status_changed.turned', { source, state }];
}

// Each kind's sentence from the context fields it needs: every field a text,
// or a number where it counts, else no sentence.
const SENTENCES: Record<
  SystemLogEntryDto['kind'],
  (c: Context, source: string) => Parts | undefined
> = {
  backup_completed: (c) =>
    text(c['backup_at'])
      ? ['kind.backup_completed', { at: c['backup_at'] }]
      : undefined,
  backup_failed: (c) =>
    text(c['last_backup_at'])
      ? ['kind.backup_failed', { since: c['last_backup_at'] }]
      : undefined,
  check_failed: (c, source) =>
    text(c['reason'])
      ? ['kind.check_failed', { reason: c['reason'], source }]
      : undefined,
  deploy: (c) =>
    text(c['version']) ? ['kind.deploy', { version: c['version'] }] : undefined,
  job_failed: ({ attempts, error_code, job, queue }) =>
    text(job) && text(queue) && number(attempts) && text(error_code)
      ? ['kind.job_failed', { attempts, error_code, job, queue }]
      : undefined,
  server_error: ({ method, route }) =>
    text(method) && text(route)
      ? ['kind.server_error', { method, route }]
      : undefined,
  service_error: (c) => {
    const answer = number(c['status']) ? c['status'] : c['reason'];
    return text(c['provider']) && (number(answer) || text(answer))
      ? ['kind.service_error', { answer, provider: capitalised(c['provider']) }]
      : undefined;
  },
  status_changed: tileChange,
};

function partsOf(entry: SystemLogEntryDto, source: string): Parts | undefined {
  const sentence = Object.hasOwn(SENTENCES, entry.kind)
    ? SENTENCES[entry.kind]
    : undefined;
  return sentence?.((entry.context ?? {}) as Context, source);
}

const MISSING = formatClock(undefined);

// Names, figures and times in the language; codes and ids as they are.
function localised(
  params: Record<string, string | number>,
  i18n: I18n,
  language: Language,
): Record<string, string | number> {
  const out = { ...params };
  if (typeof out['source'] === 'string')
    out['source'] = i18n.t(`admin.log.source.${out['source']}`);
  if (typeof out['state'] === 'string')
    out['state'] = i18n.t(`admin.log.state.${out['state']}`);
  if (typeof out['figure'] === 'string') {
    const [value, unit] = LIMITS[out['figure'] as Figure](
      out['limit'] as number,
    );
    out['limit'] = `${formatNum(value, language)} ${unit}`;
    out['figure'] = i18n.t(`admin.log.figure.${out['figure']}`);
  }
  if (typeof out['at'] === 'string') {
    const clock = formatClock(out['at']);
    if (clock !== MISSING) out['at'] = clock;
  }
  if (typeof out['since'] === 'string') {
    const clock = formatClock(out['since']);
    if (clock !== MISSING)
      out['since'] = `${formatDay(out['since'], language)}, ${clock}`;
  }
  return out;
}

// One entry's sentence in the admin's language, from its kind, source and
// figures; the stored English message when the panel cannot write it.
export function lineOf(entry: SystemLogEntryDto, i18n: I18n): string {
  const parts = partsOf(entry, entry.source);
  if (!parts) return entry.message;
  const [key, params] = parts;
  return i18n.t(`admin.log.${key}`, localised(params, i18n, i18n.language()));
}

const LAMPS: Record<SystemLogEntryDto['severity'], LampState> = {
  error: 'red',
  info: 'grey',
  warning: 'amber',
};

export interface LineView {
  at: string;
  clock: string;
  count?: { mark: string; words: string };
  id: string;
  lamp: LampState;
  text: string;
  word: string;
}

// What one line of the log shows, in the admin's language.
export function lineView(entry: SystemLogEntryDto, i18n: I18n): LineView {
  return {
    at: entry.at,
    clock: formatClock(entry.at),
    count:
      entry.count > 1
        ? {
            mark: `×${entry.count}`,
            words: i18n.t('admin.log.times', {
              count: entry.count,
              n: entry.count,
            }),
          }
        : undefined,
    id: entry.id,
    lamp: LAMPS[entry.severity],
    text: lineOf(entry, i18n),
    word: i18n.t(`admin.log.severity.${entry.severity}`),
  };
}
