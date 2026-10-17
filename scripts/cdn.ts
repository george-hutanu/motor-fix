// Keeps a Bunny pull zone equal to infra/cdn/bunny.json, and purges it.
//
//   node scripts/cdn.ts check <staging|production>   # prints each difference, exits 1 on any
//   node scripts/cdn.ts apply <staging|production>   # sends only what differs, then checks
//   node scripts/cdn.ts purge --zone                 # drops every cached file
//   node scripts/cdn.ts purge <tag...>               # drops the pages kept under each tag
//
// Reads BUNNY_API_KEY and BUNNY_PULL_ZONE_ID; check and apply also read
// CDN_ORIGIN_URL and CDN_ORIGIN_HOST, and apply ORIGIN_SECRET_EDGE, the value
// the edge sends in X-Origin-Secret. CDN_CONFIG points at another file. Exits
// 2 on bad input before any call. Neither the key nor the secret is printed:
// check compares the secret by presence only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;

const API = 'https://api.bunny.net';
const TIMEOUT_MS = 30_000;
const PURGE_GAP_MS = 100;
const ENVIRONMENTS = ['staging', 'production'];
const SECRETS = new Set(['ORIGIN_SECRET_EDGE']);

// Bunny's numeric codes for the names the file uses.
const ACTION_TYPES: Record<string, number> = {
  OverrideCacheTime: 3,
  SetRequestHeader: 6,
  SetResponseHeader: 5,
};
const TRIGGER_TYPES: Record<string, number> = { RequestHeader: 1, Url: 0 };
const MATCHING: Record<string, number> = { All: 1, Any: 0, None: 2 };

interface Trigger {
  Type: string;
  Parameter1?: string;
  PatternMatchingType: string;
  PatternMatches: string[];
}

interface Rule {
  Description: string;
  ActionType: string;
  ActionParameter1: string;
  ActionParameter2?: string;
  TriggerMatchingType: string;
  Triggers: Trigger[];
}

interface Zone {
  pullZone: Record<string, unknown>;
  hostnames: { ForceSSL: boolean };
  edgeRules: Rule[];
}

interface LiveRule extends Json {
  Description: string;
  Guid: string;
}

interface Live extends Json {
  EdgeRules: LiveRule[];
  Hostnames: { Value: string; ForceSSL: boolean }[];
}

class Refused extends Error {}

type Api = (method: string, path: string, body?: Json) => Promise<unknown>;

export async function run(
  argv: string[],
  env: Env = process.env,
  send: typeof fetch = fetch,
): Promise<number> {
  const [command = '', ...rest] = argv;
  if (command === 'purge') return purge(rest, env, send);
  const name = rest.length === 1 ? (rest[0] ?? '') : '';
  if (!['check', 'apply'].includes(command) || !ENVIRONMENTS.includes(name)) {
    return usage();
  }
  const zone = loadZone(command, name, env);
  if (typeof zone === 'number') return zone;
  return sync(command, zone, client(env, send), env);
}

// The environment's zone from the file, its variables read; an exit code
// when the input is not usable.
function loadZone(command: string, name: string, env: Env): Zone | number {
  const needed = [
    'BUNNY_API_KEY',
    'BUNNY_PULL_ZONE_ID',
    'CDN_ORIGIN_URL',
    'CDN_ORIGIN_HOST',
  ];
  if (command === 'apply') needed.push('ORIGIN_SECRET_EDGE');
  if (!present(env, needed)) return 2;
  const errors: string[] = [];
  const file = readConfig(env, errors);
  for (const error of errors) console.error(error);
  if (errors.length) return 2;
  const raw = file.environments[name] as Zone;
  // check compares the secret by presence only, so it needs no value.
  const read = variablesOf(raw).filter(
    (name) => command === 'apply' || !SECRETS.has(name),
  );
  if (!present(env, read)) return 2;
  const zone = substitute(raw, env);
  if (!String(zone.pullZone['OriginUrl'] ?? '').startsWith('https://')) {
    console.error('pullZone.OriginUrl must be an https:// address');
    return 2;
  }
  return zone;
}

async function sync(command: string, zone: Zone, api: Api, env: Env) {
  try {
    let live = (await api('GET', '')) as Live;
    if (command === 'apply') {
      await apply(api, zone, live, env);
      live = (await api('GET', '')) as Live;
    }
    // check compares the secret by presence only; apply by its value.
    return report(compare(zone, live, command === 'apply' ? env : null));
  } catch (error) {
    console.error(hide(message(error), env));
    return 1;
  }
}

function report(differences: string[]) {
  for (const line of differences) console.log(line);
  console.log('shield: not checked');
  if (differences.length) return 1;
  console.log('ok');
  return 0;
}

async function apply(api: Api, zone: Zone, live: Live, env: Env) {
  const changed = Object.fromEntries(
    Object.entries(zone.pullZone).filter(
      ([key, value]) => !same(value, live[key]),
    ),
  );
  if (Object.keys(changed).length) await api('POST', '', changed);
  await applyRules(api, zone, live, env);
  for (const host of live.Hostnames) {
    if (host.ForceSSL === zone.hostnames.ForceSSL) continue;
    await api('POST', '/setForceSSL', {
      ForceSSL: zone.hostnames.ForceSSL,
      Hostname: host.Value,
    });
  }
}

// A rule that differs is sent whole under its live Guid; a missing one is
// added; a rule the file does not name goes.
async function applyRules(api: Api, zone: Zone, live: Live, env: Env) {
  const byName = rulesByName(live);
  for (const rule of zone.edgeRules) {
    const current = byName.get(rule.Description);
    if (current && !ruleDifferences(rule, current, env).length) continue;
    await api('POST', '/edgerules/addOrUpdate', {
      ...toLive(rule, env),
      ...(current ? { Guid: current.Guid } : {}),
    });
  }
  for (const rule of extraRules(zone, live)) {
    await api('DELETE', `/edgerules/${encodeURIComponent(rule.Guid)}`);
  }
}

// `env` null compares the secret by presence only.
function compare(zone: Zone, live: Live, env: Env | null): string[] {
  const lines = Object.entries(zone.pullZone).map(([key, value]) =>
    key in live
      ? difference(`pullZone.${key}`, value, live[key])
      : `pullZone.${key}: unknown field`,
  );
  for (const host of live.Hostnames) {
    lines.push(
      difference(
        `hostname ${host.Value} ForceSSL`,
        zone.hostnames.ForceSSL,
        host.ForceSSL,
      ),
    );
  }
  const byName = rulesByName(live);
  for (const rule of zone.edgeRules) {
    const current = byName.get(rule.Description);
    if (current) lines.push(...ruleDifferences(rule, current, env));
    else lines.push(`rule ${rule.Description}: missing`);
  }
  for (const rule of extraRules(zone, live)) {
    lines.push(`rule ${rule.Description}: extra`);
  }
  return lines.filter((line): line is string => Boolean(line));
}

// The first live rule of each name; a later one of the same name is extra.
function rulesByName(live: Live) {
  const byName = new Map<string, LiveRule>();
  for (const rule of live.EdgeRules) {
    if (!byName.has(rule.Description)) byName.set(rule.Description, rule);
  }
  return byName;
}

// Every live rule the file does not name, and every second rule of a name:
// the file owns the zone's rules.
function extraRules(zone: Zone, live: Live) {
  const wanted = new Set(zone.edgeRules.map((rule) => rule.Description));
  const byName = rulesByName(live);
  return live.EdgeRules.filter(
    (rule) =>
      !wanted.has(rule.Description) || byName.get(rule.Description) !== rule,
  );
}

function ruleDifferences(rule: Rule, live: Json, env: Env | null): string[] {
  const at = `rule ${rule.Description}`;
  return Object.entries(toLive(rule, env ?? {}))
    .map(([key, value]) =>
      secretOf(rule, key)
        ? secretDifference(`${at} ${key}`, value, live[key], env)
        : difference(`${at} ${key}`, value, triggersOf(key, value, live[key])),
    )
    .filter((line): line is string => Boolean(line));
}

function difference(at: string, file: unknown, live: unknown) {
  return same(file, live)
    ? undefined
    : `${at}: file ${show(file)}, live ${show(live)}`;
}

// Never prints either value.
function secretDifference(
  at: string,
  file: unknown,
  live: unknown,
  env: Env | null,
) {
  const differs = env ? file !== live : !live;
  if (!differs) return undefined;
  return `${at}: file <set>, live ${live ? '<other>' : '<unset>'}`;
}

// The variable a rule field is read from, when it is a secret.
function secretOf(rule: Rule, key: string): string | undefined {
  const value = (rule as unknown as Json)[key];
  const name = typeof value === 'string' ? variable(value) : undefined;
  return name && SECRETS.has(name) ? name : undefined;
}

// The live triggers cut down to the fields the file's carry: Bunny answers
// with more than it is sent.
function triggersOf(key: string, wanted: unknown, live: unknown): unknown {
  if (key !== 'Triggers' || !Array.isArray(wanted) || !Array.isArray(live)) {
    return live;
  }
  return live.map((trigger: unknown, index) => {
    if (!isObject(trigger)) return trigger;
    const keys = Object.keys((wanted[index] as Json | undefined) ?? {});
    return Object.fromEntries(
      keys.map((name) => [name, trigger[name] ?? null]),
    );
  });
}

function toLive(rule: Rule, env: Env): Json {
  return {
    ActionParameter1: rule.ActionParameter1,
    ...(rule.ActionParameter2 === undefined
      ? {}
      : { ActionParameter2: resolve(rule.ActionParameter2, env) }),
    ActionType: ACTION_TYPES[rule.ActionType],
    Description: rule.Description,
    Enabled: true,
    TriggerMatchingType: MATCHING[rule.TriggerMatchingType],
    Triggers: rule.Triggers.map((trigger) => ({
      Parameter1: trigger.Parameter1 ?? null,
      PatternMatches: trigger.PatternMatches,
      PatternMatchingType: MATCHING[trigger.PatternMatchingType],
      Type: TRIGGER_TYPES[trigger.Type],
    })),
  };
}

async function purge(args: string[], env: Env, send: typeof fetch) {
  const zone = args.length === 1 && args[0] === '--zone';
  if (
    !args.length ||
    (!zone && args.some((tag) => !tag.trim() || tag.startsWith('-')))
  ) {
    return usage();
  }
  if (!present(env, ['BUNNY_API_KEY', 'BUNNY_PULL_ZONE_ID'])) return 2;
  const api = client(env, send);
  return zone ? purgeZone(api, env) : purgeTags(api, args);
}

async function purgeZone(api: Api, env: Env) {
  try {
    await api('POST', '/purgeCache');
    return 0;
  } catch (error) {
    console.error(`purge failed: ${hide(message(error), env)}`);
    return 1;
  }
}

// One call per tag, a little apart; a tag the CDN refused is named and the
// rest still go.
async function purgeTags(api: Api, tags: string[]) {
  let code = 0;
  for (const [index, tag] of tags.entries()) {
    if (index) await new Promise((done) => setTimeout(done, PURGE_GAP_MS));
    try {
      await api('POST', '/purgeCache', { CacheTag: tag });
    } catch {
      console.error(`purge failed: ${tag}`);
      code = 1;
    }
  }
  return code;
}

// One pull zone's calls. A refused call throws its method, path, status and
// the provider's message; the key is only ever a header.
function client(env: Env, send: typeof fetch): Api {
  const zone = encodeURIComponent(env['BUNNY_PULL_ZONE_ID']?.trim() ?? '');
  return async (method, path, body) => {
    const answer = await send(`${API}/pullzone/${zone}${path}`, {
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        Accept: 'application/json',
        AccessKey: env['BUNNY_API_KEY'] ?? '',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await answer.text();
    if (!answer.ok) {
      throw new Refused(
        `${method} /pullzone/<zone>${path}: ${answer.status} ${text.slice(0, 200)}`,
      );
    }
    return text ? JSON.parse(text) : undefined;
  };
}

function message(error: unknown) {
  return error instanceof Refused ? error.message : String(error);
}

// The key and the secret, wherever a provider or an error echoes them.
function hide(text: string, env: Env) {
  return ['BUNNY_API_KEY', ...SECRETS].reduce((out, name) => {
    const value = env[name]?.trim();
    return value ? out.split(value).join('<hidden>') : out;
  }, text);
}

function readConfig(env: Env, errors: string[]): { environments: Json } {
  // Run from the repository root, as the release workflow does.
  const path =
    env['CDN_CONFIG'] || join(process.cwd(), 'infra', 'cdn', 'bunny.json');
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`${path}: ${String(error)}`);
    return { environments: {} };
  }
  if (!isObject(file) || !isObject(file['environments'])) {
    errors.push('environments: missing');
    return { environments: {} };
  }
  const environments = file['environments'];
  for (const name of ENVIRONMENTS) {
    validateZone(environments[name], `environments.${name}`, errors);
  }
  return { environments };
}

function validateZone(zone: unknown, at: string, errors: string[]) {
  if (!isObject(zone)) {
    errors.push(`${at}: missing`);
    return;
  }
  if (!isObject(zone['pullZone'])) errors.push(`${at}.pullZone: missing`);
  const hostnames = zone['hostnames'];
  if (!isObject(hostnames) || typeof hostnames['ForceSSL'] !== 'boolean') {
    errors.push(`${at}.hostnames.ForceSSL: missing`);
  }
  const rules = zone['edgeRules'];
  if (!Array.isArray(rules)) {
    errors.push(`${at}.edgeRules: missing`);
    return;
  }
  for (const [index, rule] of rules.entries()) {
    validateRule(rule, `${at}.edgeRules[${index}]`, errors);
  }
}

function validateRule(rule: unknown, at: string, errors: string[]) {
  if (!isObject(rule)) {
    errors.push(`${at}: missing`);
    return;
  }
  for (const key of ['Description', 'ActionParameter1']) {
    const value = rule[key];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${at}.${key}: missing`);
    }
  }
  oneOf(rule['ActionType'], ACTION_TYPES, `${at}.ActionType`, errors);
  oneOf(
    rule['TriggerMatchingType'],
    MATCHING,
    `${at}.TriggerMatchingType`,
    errors,
  );
  const triggers = rule['Triggers'];
  if (!Array.isArray(triggers) || !triggers.length) {
    errors.push(`${at}.Triggers: missing`);
    return;
  }
  for (const [index, trigger] of triggers.entries()) {
    validateTrigger(trigger, `${at}.Triggers[${index}]`, errors);
  }
}

function validateTrigger(trigger: unknown, at: string, errors: string[]) {
  if (!isObject(trigger)) {
    errors.push(`${at}: missing`);
    return;
  }
  oneOf(trigger['Type'], TRIGGER_TYPES, `${at}.Type`, errors);
  oneOf(
    trigger['PatternMatchingType'],
    MATCHING,
    `${at}.PatternMatchingType`,
    errors,
  );
  const patterns = trigger['PatternMatches'];
  if (
    !Array.isArray(patterns) ||
    !patterns.every((p) => typeof p === 'string')
  ) {
    errors.push(`${at}.PatternMatches: missing`);
  }
}

function oneOf(
  value: unknown,
  codes: Record<string, number>,
  at: string,
  errors: string[],
) {
  if (value === undefined) errors.push(`${at}: missing`);
  else if (typeof value !== 'string' || !(value in codes)) {
    errors.push(`${at}: unknown ${String(value)}`);
  }
}

// Every `$NAME` in the pull zone is replaced by the variable's value. Rule
// fields are read only when a call is built, so the secret is never in what
// gets compared for check or printed.
function substitute(zone: Zone, env: Env): Zone {
  const pullZone = Object.fromEntries(
    Object.entries(zone.pullZone).map(([key, value]) => [
      key,
      typeof value === 'string' ? resolve(value, env) : value,
    ]),
  );
  return { ...zone, pullZone };
}

// Every variable the zone reads, in its pull zone and its rules.
function variablesOf(zone: Zone): string[] {
  const values = [
    ...Object.values(zone.pullZone),
    ...zone.edgeRules.flatMap((rule) => [
      rule.ActionParameter1,
      rule.ActionParameter2,
    ]),
  ];
  const names = values.map((value) =>
    typeof value === 'string' ? variable(value) : undefined,
  );
  return [...new Set(names)].filter((name): name is string => Boolean(name));
}

function resolve(value: string, env: Env): string {
  const name = variable(value);
  return name ? (env[name] ?? '') : value;
}

function variable(value: string): string | undefined {
  return /^\$([A-Z][A-Z0-9_]*)$/.exec(value)?.[1];
}

function present(env: Env, names: string[]): boolean {
  const missing = names.filter((name) => !env[name]?.trim());
  for (const name of missing) {
    console.error(`missing environment variable ${name}`);
  }
  // The zone id goes into the address called: a number, nothing else.
  const zone = env['BUNNY_PULL_ZONE_ID'];
  const badZone =
    names.includes('BUNNY_PULL_ZONE_ID') &&
    !missing.includes('BUNNY_PULL_ZONE_ID') &&
    !/^\d+$/.test(zone?.trim() ?? '');
  if (badZone) console.error('BUNNY_PULL_ZONE_ID must be a number');
  return !missing.length && !badZone;
}

function usage() {
  console.error(
    'usage: cdn.ts check|apply <staging|production> | purge --zone | purge <tag...>',
  );
  return 2;
}

// Equal whatever the order of their keys.
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isObject(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([x], [y]) => x.localeCompare(y)),
        )
      : inner,
  );
}

function show(value: unknown) {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1]?.endsWith('cdn.ts')) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
