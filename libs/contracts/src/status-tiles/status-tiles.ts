import { bucharestClock } from '../open-status';

// The admin dashboard's service tiles, in the order the panel shows them.
export const TILES = [
  'api',
  'search',
  'maps',
  'email',
  'notifications',
  'backup',
] as const;
export type TileKey = (typeof TILES)[number];
export type TileState = 'green' | 'amber' | 'red';

// A tile with no check for this long reads red: "no data since".
export const STALE_AFTER_MS = 180_000;

export interface StatusTexts {
  ro: string;
  en: string;
}

// A tile as the panel answers it, before its texts are put on.
export interface StatusTileView {
  key: TileKey;
  state: TileState;
  since: Date | null;
  stale: boolean;
  detail: Record<string, number | string>;
}

const NAMES: Record<TileKey, StatusTexts> = {
  api: { en: 'API', ro: 'API' },
  backup: { en: 'Backup', ro: 'Backup' },
  email: { en: 'E-mail', ro: 'E-mail' },
  maps: { en: 'Maps', ro: 'Hărți' },
  notifications: { en: 'Notifications', ro: 'Notificări' },
  search: { en: 'Search', ro: 'Căutare' },
};

type Effect = Record<'amber' | 'red', (t: string) => StatusTexts>;

const EFFECTS: Record<Exclude<TileKey, 'backup'>, Effect> = {
  api: {
    amber: (t) => ({
      en: `The app has been slow since ${t}. Pages may load slowly.`,
      ro: `Aplicația răspunde lent din ${t}. Paginile se pot încărca greu.`,
    }),
    red: (t) => ({
      en: `The app has not answered since ${t}. Drivers and garages cannot use it.`,
      ro: `Aplicația nu răspunde din ${t}. Șoferii și service-urile nu o pot folosi.`,
    }),
  },
  email: {
    amber: (t) => ({
      en: `E-mails have been going out late since ${t}. Confirmations and verification results may be delayed.`,
      ro: `E-mailurile pleacă cu întârziere din ${t}. Confirmările și rezultatele verificării pot întârzia.`,
    }),
    red: (t) => ({
      en: `E-mails have not gone out since ${t}. Confirmations and verification results do not arrive.`,
      ro: `E-mailurile nu pleacă din ${t}. Confirmările și rezultatele verificării nu ajung.`,
    }),
  },
  maps: {
    amber: (t) => ({
      en: `Maps have been slow since ${t}. Distance sorting may lag.`,
      ro: `Hărțile răspund lent din ${t}. Căutarea după distanță poate întârzia.`,
    }),
    red: (t) => ({
      en: `Maps have not loaded since ${t}. Results show as a list only.`,
      ro: `Hărțile nu se încarcă din ${t}. Rezultatele apar doar ca listă.`,
    }),
  },
  notifications: {
    amber: (t) => ({
      en: `Notifications have been going out late since ${t}. Drivers and garages may hear about quotes and bookings later.`,
      ro: `Notificările pleacă cu întârziere din ${t}. Șoferii și service-urile pot afla mai târziu de oferte și programări.`,
    }),
    red: (t) => ({
      en: `Notifications have not gone out since ${t}. Drivers and garages do not hear about quotes and bookings.`,
      ro: `Notificările nu pleacă din ${t}. Șoferii și service-urile nu află de oferte și programări.`,
    }),
  },
  search: {
    amber: (t) => ({
      en: `Search has been slow since ${t}. Results may appear late.`,
      ro: `Căutarea merge greu din ${t}. Rezultatele pot apărea cu întârziere.`,
    }),
    red: (t) => ({
      en: `Search has not worked since ${t}. Drivers cannot find garages.`,
      ro: `Căutarea nu merge din ${t}. Șoferii nu găsesc service-uri.`,
    }),
  },
};

export const allClearSentence: StatusTexts = {
  en: 'All services are running normally.',
  ro: 'Toate serviciile merg normal.',
};

const same = (text: string): StatusTexts => ({ en: text, ro: text });

const SECONDS = {
  en: new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }),
  ro: new Intl.NumberFormat('ro-RO', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }),
};

const DAY_MONTH = {
  en: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Bucharest',
  }),
  ro: new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Bucharest',
  }),
};

const timeOf = (at: Date) => bucharestClock(at).time;

function latency(detail: StatusTileView['detail']): StatusTexts | null {
  const value = detail['latency_ms'];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const ms = Math.round(value);
  if (ms < 1000) return same(`${ms} ms`);
  return {
    en: `${SECONDS.en.format(ms / 1000)} s`,
    ro: `${SECONDS.ro.format(ms / 1000)} s`,
  };
}

function lastBackup(detail: StatusTileView['detail']): Date | null {
  const value = detail['last_backup_at'];
  if (typeof value !== 'string') return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

const dated = (at: Date): StatusTexts => ({
  en: `${DAY_MONTH.en.format(at)}, ${timeOf(at)}`,
  ro: `${DAY_MONTH.ro.format(at)}, ${timeOf(at)}`,
});

const dayBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);

// Today and yesterday are calendar days in Bucharest.
function backupShort(detail: StatusTileView['detail'], now: Date): StatusTexts {
  const last = lastBackup(detail);
  if (!last) return { en: 'last: never', ro: 'ultimul: niciodată' };
  const day = bucharestClock(last).day;
  const today = bucharestClock(now).day;
  if (day === today)
    return { en: `last: ${timeOf(last)}`, ro: `ultimul: ${timeOf(last)}` };
  if (day === dayBefore(today))
    return {
      en: `last: yesterday, ${timeOf(last)}`,
      ro: `ultimul: ieri, ${timeOf(last)}`,
    };
  const when = dated(last);
  return { en: `last: ${when.en}`, ro: `ultimul: ${when.ro}` };
}

function short(tile: StatusTileView, now: Date): StatusTexts {
  if (tile.stale) {
    if (!tile.since) return { en: 'no data', ro: 'fără date' };
    const t = timeOf(tile.since);
    return { en: `no data since ${t}`, ro: `fără date din ${t}` };
  }
  if (tile.key === 'backup') return backupShort(tile.detail, now);
  if (tile.state === 'red') return { en: 'down', ro: 'căzut' };
  if (tile.key === 'email' || tile.key === 'notifications')
    return tile.state === 'amber'
      ? { en: 'delays', ro: 'întârzieri' }
      : same('normal');
  return timedShort(tile);
}

function timedShort(tile: StatusTileView): StatusTexts {
  const word =
    tile.state === 'amber' ? { en: 'slow', ro: 'lent' } : same('normal');
  const ms = latency(tile.detail);
  return ms
    ? { en: `${word.en} · ${ms.en}`, ro: `${word.ro} · ${ms.ro}` }
    : word;
}

function sentence(tile: StatusTileView): StatusTexts | null {
  const name = NAMES[tile.key];
  if (tile.stale) {
    if (!tile.since)
      return {
        en: `There is no data on ${name.en} yet.`,
        ro: `Nu avem încă date despre ${name.ro}.`,
      };
    const t = timeOf(tile.since);
    return {
      en: `No data on ${name.en} since ${t}. The service may be in another state.`,
      ro: `Nu avem date despre ${name.ro} din ${t}. Starea serviciului poate fi alta.`,
    };
  }
  if (tile.state === 'green') return null;
  if (tile.key === 'backup') {
    const last = lastBackup(tile.detail);
    if (!last)
      return {
        en: 'There is no successful backup yet.',
        ro: 'Nu există încă un backup reușit.',
      };
    const when = dated(last);
    return {
      en: `The last successful backup is from ${when.en}.`,
      ro: `Ultimul backup reușit este din ${when.ro}.`,
    };
  }
  const t = tile.since ? timeOf(tile.since) : '--:--';
  return EFFECTS[tile.key][tile.state](t);
}

// The tile's short state and, when it is a problem, the sentence saying what
// it means for drivers and garages; shared by the panel and the admin alert.
export function statusTexts(
  tile: StatusTileView,
  now: Date,
): { short: StatusTexts; sentence: StatusTexts | null } {
  return { sentence: sentence(tile), short: short(tile, now) };
}
