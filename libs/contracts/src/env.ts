const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export type Env<K extends string> = Record<K, string> & {
  APP_ENV: AppEnv;
  RELEASE_SHA: string;
};

// Errors name the variable and never echo a value: values may be secrets.
export function readEnv<K extends string>(
  required: readonly K[],
  source: Record<string, string | undefined> = process.env,
): Env<K> {
  const own = (name: string) =>
    Object.hasOwn(source, name) ? source[name] : undefined;
  const appEnv = own('APP_ENV');
  if (!APP_ENVS.includes(appEnv as AppEnv)) {
    throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}`);
  }
  const env: Record<string, string> = {
    APP_ENV: appEnv as AppEnv,
    RELEASE_SHA: own('RELEASE_SHA') || 'dev',
  };
  for (const name of required) {
    const value = own(name);
    if (!value) throw new Error(`missing environment variable ${name}`);
    env[name] = value;
  }
  return env as Env<K>;
}

export const STORAGE_ENV = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
] as const;

export type StorageEnv = Record<(typeof STORAGE_ENV)[number], string>;

// Sign-in with a provider: optional, a provider is offered only when all its
// keys are set. The issuer overrides point at a stand-in in development and
// tests only.
export const GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

export const APPLE_ENV = [
  'APPLE_SERVICES_ID',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
] as const;

// The address look-up's key: unset, the api still boots and the look-up says
// it is down (a stand-in answers in tests).
export const PLACES_ENV = ['GEOAPIFY_API_KEY'] as const;

export function placesApiKey(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  const [key] = PLACES_ENV;
  return source[key]?.trim() || undefined;
}

// The five values the live video provider needs. Any one missing or blank
// leaves live video off, so the api still boots.
export const LIVE_VIDEO_ENV = [
  'CLOUDFLARE_STREAM_ACCOUNT_ID',
  'CLOUDFLARE_STREAM_API_TOKEN',
  'CLOUDFLARE_STREAM_CUSTOMER_CODE',
  'CLOUDFLARE_STREAM_SIGNING_KEY_ID',
  'CLOUDFLARE_STREAM_SIGNING_KEY_PEM',
] as const;

export type LiveVideoSecrets = Record<(typeof LIVE_VIDEO_ENV)[number], string>;

export function liveVideoSecrets(
  source: Record<string, string | undefined> = process.env,
): LiveVideoSecrets | undefined {
  const secrets = {} as LiveVideoSecrets;
  for (const name of LIVE_VIDEO_ENV) {
    const value = source[name]?.trim();
    if (!value) return undefined;
    secrets[name] = value;
  }
  return secrets;
}

// The values the CDN may send in X-Origin-Secret, comma-separated so a new
// one can be added before the old one goes. Empty: the web answers everyone.
export function originSecrets(
  source: Record<string, string | undefined> = process.env,
): string[] {
  return (source['ORIGIN_SECRET'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

// The CDN's API key and pull zone: both set, the worker sends purges.
export function bunnyConfig(
  source: Record<string, string | undefined> = process.env,
): { apiKey: string; pullZoneId: string } | undefined {
  const apiKey = source['BUNNY_API_KEY']?.trim();
  const pullZoneId = source['BUNNY_PULL_ZONE_ID']?.trim();
  // The zone id goes into the purge address: a number, nothing else.
  return apiKey && pullZoneId && /^\d+$/.test(pullZoneId)
    ? { apiKey, pullZoneId }
    : undefined;
}

// The bearer Grafana's outage contact point sends; unset refuses every call.
export function outageWebhookToken(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  return source['OUTAGE_WEBHOOK_TOKEN']?.trim() || undefined;
}

// The web app's public address: unset in development and at build time.
export function publicWebUrl(
  source: Record<string, string | undefined> = process.env,
): URL | undefined {
  const value = source['PUBLIC_WEB_URL'];
  if (!value) return undefined;
  if (!URL.canParse(value)) {
    throw new Error('PUBLIC_WEB_URL must be an absolute URL');
  }
  return new URL(value);
}

const SUBMIT_TIMEOUT_MS = 30_000;

// How long the send's transaction may run: LISTING_SUBMIT_TX_TIMEOUT_MS, in
// milliseconds, or 30 seconds when it is not set.
export function submitTimeoutMs(
  source: Record<string, string | undefined> = process.env,
): number {
  return wholeMs('LISTING_SUBMIT_TX_TIMEOUT_MS', SUBMIT_TIMEOUT_MS, source);
}

const BRAND_LOAD_TIMEOUT_MS = 60_000;

// How long the brand load's transaction may run: BRAND_LOAD_TIMEOUT_MS, in
// milliseconds, or 60 seconds when it is not set.
export function brandLoadTimeoutMs(
  source: Record<string, string | undefined> = process.env,
): number {
  return wholeMs('BRAND_LOAD_TIMEOUT_MS', BRAND_LOAD_TIMEOUT_MS, source);
}

function wholeMs(
  name: string,
  fallback: number,
  source: Record<string, string | undefined>,
): number {
  const value = source[name];
  if (!value) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return Number(value);
}

// The browser collector's address (Grafana Faro): unset means the browser
// sends nothing. Its path carries the app key, so a bad value is never echoed.
export function faroUrl(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  return optionalUrl('FARO_URL', source);
}

// The site name Plausible counts page views under: unset means the browser
// never loads analytics, whatever the visitor chose.
export function plausibleDomain(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = source['PLAUSIBLE_DOMAIN']?.trim();
  if (!value) return undefined;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)) {
    throw new Error('PLAUSIBLE_DOMAIN must be a domain name');
  }
  return value;
}

// The Grafana stack the admin panel links to; unset means no link. Grafana's
// own sign-in guards the dashboards, so the URL carries no credential.
export function grafanaUrl(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  return optionalUrl('GRAFANA_URL', source);
}

// The vector tiles the static map image is drawn from, as a TileJSON
// address; `off` calls no provider and draws the ground colour only, which
// the end-to-end and QA runs use so no test fetches a tile.
const MAP_TILES_DEFAULT = 'https://tiles.openfreemap.org/planet';

export function mapTilesTileJsonUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const value = source['MAP_TILES_TILEJSON_URL'];
  if (value === undefined || value === '') return MAP_TILES_DEFAULT;
  if (value === 'off') return value;
  const url = /^https?:\/\//i.test(value) ? URL.parse(value) : null;
  if (!url) {
    throw new Error(
      'MAP_TILES_TILEJSON_URL must be an absolute http(s) URL or off',
    );
  }
  return url.href;
}

function optionalUrl(
  name: string,
  source: Record<string, string | undefined>,
): string | undefined {
  const value = source[name];
  if (value === undefined || value === '') return undefined;
  const url = /^https?:\/\//i.test(value) ? URL.parse(value) : null;
  if (!url) throw new Error(`${name} must be an absolute http(s) URL`);
  return url.href;
}

// Telemetry: optional; unset endpoint means off. Grafana Cloud's OTLP gateway
// in staging and production, the local otel-lgtm profile in development. The
// headers carry the Grafana Cloud token and never reach an error.
export function telemetry(
  source: Record<string, string | undefined> = process.env,
):
  | {
      endpoint: URL;
      headers?: string;
      protocol: 'http/protobuf';
      env: AppEnv;
      traceSampleRatio: number;
    }
  | undefined {
  const value = source['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!value) return undefined;
  const endpoint = URL.parse(value);
  if (endpoint?.protocol !== 'http:' && endpoint?.protocol !== 'https:') {
    throw new Error(
      'OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute http(s) URL',
    );
  }
  const protocol = source['OTEL_EXPORTER_OTLP_PROTOCOL'] || 'http/protobuf';
  if (protocol !== 'http/protobuf') {
    throw new Error('OTEL_EXPORTER_OTLP_PROTOCOL must be http/protobuf');
  }
  const { APP_ENV: env } = readEnv([], source);
  const headers = source['OTEL_EXPORTER_OTLP_HEADERS'];
  return {
    endpoint,
    ...(headers ? { headers } : {}),
    env,
    protocol,
    traceSampleRatio: env === 'production' ? 0.2 : 1,
  };
}

const wholeNumber = (value: string | undefined, fallback: number) =>
  value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : fallback;

// The photo pipeline's limits. sharp's own default pixel limit is the
// fallback; the worker defaults to one photo per core, since each photo's
// sharp calls run on one thread.
export function photoConfig(
  source: Record<string, string | undefined> = process.env,
) {
  return {
    attempts: wholeNumber(source['PHOTO_JOB_ATTEMPTS'], 3),
    concurrency: wholeNumber(
      source['PHOTO_WORKER_CONCURRENCY'],
      navigator.hardwareConcurrency,
    ),
    keepFailed: wholeNumber(source['PHOTO_JOB_KEEP_FAILED'], 100),
    maxInputPixels: wholeNumber(source['PHOTO_MAX_INPUT_PIXELS'], 268_402_689),
  };
}

// How long a job's photos and clips are kept, read when an item is sent and
// by the nightly purge; a value that is not a whole number of days stops the
// app rather than keeping media for a default nobody chose.
export function mediaConfig(
  source: Record<string, string | undefined> = process.env,
) {
  const days = source['MEDIA_RETENTION_DAYS'];
  if (days && wholeNumber(days, 0) === 0) {
    throw new Error('MEDIA_RETENTION_DAYS must be a whole number of days');
  }
  return {
    retentionDays: wholeNumber(days, 90),
    workerConcurrency: wholeNumber(source['MEDIA_WORKER_CONCURRENCY'], 1),
  };
}

// Where the browser loads photo variants from: the API on the same origin
// until a CDN host is set.
export function imageBaseUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const value = source['IMAGE_BASE_URL'];
  if (!value) return '/api/v1/images';
  const absolute = /^https?:\/\/[^/]/i.test(value) && URL.canParse(value);
  if (!absolute && !/^\/(?!\/)/.test(value)) {
    throw new Error(
      'IMAGE_BASE_URL must be an http(s) URL or a path starting with /',
    );
  }
  return value.replace(/\/+$/, '');
}
