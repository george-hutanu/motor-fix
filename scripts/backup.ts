// The parts of the nightly backup and the restore drill that are decisions
// rather than plumbing, so they are tested here and the shell scripts stay
// thin (scripts/backup/*.sh, .github/workflows/backup.yml, restore-drill.yml).
//
//   node scripts/backup.ts settings              skip=true|false, or exit 1 naming the missing setting
//   node scripts/backup.ts key <env> [<iso>]     <env>/<YYYYMMDDTHHMMSSZ>
//   node scripts/backup.ts prune <env> [<iso>]   keys to delete, from a list-objects-v2 listing on stdin
//   node scripts/backup.ts compare <manifest> <counts>   exit 1 naming each table whose rows differ
//   node scripts/backup.ts report                step timings on stdin, padded, with the total
//
// No command prints a setting's value.

import { readFileSync } from 'node:fs';

export const RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

// An environment without its PostgreSQL service named has no database to back
// up yet (production while it is off), so it is skipped rather than failed.
const SERVICE = 'RAILWAY_SERVICE_POSTGRES';
const REQUIRED = [
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_REGION',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_GPG_PASSPHRASE',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_API_TOKEN',
];

type Env = Record<string, string | undefined>;

export function settings(env: Env): { skip: boolean } | { missing: string } {
  const set = (name: string) => (env[name] ?? '').trim() !== '';
  if (!set(SERVICE)) return { skip: true };
  const missing = REQUIRED.find((name) => !set(name));
  return missing ? { missing } : { skip: false };
}

const stamp = (at: Date) =>
  at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');

// The environment is a path segment of the bucket key, so only the two that
// exist are accepted.
const ENVIRONMENTS = ['staging', 'production'];

export function backupKey(environment: string, at: Date): string {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`unknown environment ${JSON.stringify(environment)}`);
  }
  return `${environment}/${stamp(at)}`;
}

const KEY =
  /^([^/]+)\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.(dump\.gpg|manifest\.json)$/;

function keyTime(key: string, environment: string): number | null {
  const m = KEY.exec(key);
  if (!m || m[1] !== environment) return null;
  const [, , y, mo, d, h, mi, s] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

// Age is read from the key, not the object's date, and the newest copy stays
// whatever its age, so a run of failed nights never empties the bucket.
export function pruneKeys(
  keys: string[],
  environment: string,
  now: Date,
): string[] {
  const times = keys.map((key) => keyTime(key, environment));
  const newest = Math.max(...times.filter((t): t is number => t !== null));
  const limit = now.getTime() - RETENTION_DAYS * DAY_MS;
  return keys.filter((_key, i) => {
    const t = times[i];
    return t !== null && t !== newest && t < limit;
  });
}

export function compare(
  manifest: Record<string, number>,
  restored: Record<string, number>,
): string[] {
  const has = (side: Record<string, number>, name: string) =>
    Object.hasOwn(side, name);
  const names = [
    ...new Set([...Object.keys(manifest), ...Object.keys(restored)]),
  ].sort();
  return names.flatMap((name) => {
    if (!has(restored, name)) return [`table ${name}: missing in restore`];
    if (!has(manifest, name)) return [`table ${name}: missing in manifest`];
    return manifest[name] === restored[name]
      ? []
      : [
          `table ${name}: manifest ${manifest[name]}, restored ${restored[name]}`,
        ];
  });
}

export function report(steps: string): string {
  const rows = steps
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, seconds]) => [name as string, Number(seconds)] as const)
    .filter(([, seconds]) => Number.isFinite(seconds));
  const total = rows.reduce((sum, [, seconds]) => sum + seconds, 0);
  return [...rows, ['total', total] as const]
    .map(
      ([name, seconds]) => `${name.padEnd(8)}${String(seconds).padStart(5)} s`,
    )
    .join('\n');
}

// A manifest saved by an editor may start with a byte order mark.
const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const stdin = () => readFileSync(0, 'utf8');
const when = (iso: string | undefined) => (iso ? new Date(iso) : new Date());

const print = (lines: string[]) => {
  if (lines.length) console.log(lines.join('\n'));
};

const COMMANDS: Record<string, (args: string[]) => number> = {
  compare: ([manifest = '', counts = '']) => {
    const tables = readJson(manifest).tables ?? {};
    const lines = compare(tables, readJson(counts));
    if (Object.keys(tables).length === 0) {
      lines.unshift('manifest names no tables');
    }
    print(lines);
    return lines.length ? 1 : 0;
  },
  key: ([environment = '', iso]) => {
    console.log(backupKey(environment, when(iso)));
    return 0;
  },
  prune: ([environment = '', iso]) => {
    const text = stdin().trim();
    const listing = text ? JSON.parse(text) : {};
    const keys = (listing.Contents ?? []).map(
      (object: { Key: string }) => object.Key,
    );
    print(pruneKeys(keys, environment, when(iso)));
    return 0;
  },
  report: () => {
    console.log(report(stdin()));
    return 0;
  },
  settings: () => {
    const result = settings(process.env);
    if ('missing' in result) {
      console.error(`missing ${result.missing}`);
      return 1;
    }
    console.log(`skip=${result.skip}`);
    return 0;
  },
};

function main(): number {
  const [command = '', ...args] = process.argv.slice(2);
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (run) return run(args);
  console.error(
    'Usage: node scripts/backup.ts settings|key|prune|compare|report',
  );
  return 2;
}

if (process.argv[1]?.endsWith('backup.ts')) process.exitCode = main();
