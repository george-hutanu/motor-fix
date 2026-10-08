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

// The browser collector's address (Grafana Faro): unset means the browser
// sends nothing. Its path carries the app key, so a bad value is never echoed.
export function faroUrl(
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = source['FARO_URL'];
  if (value === undefined || value === '') return undefined;
  const url =
    typeof value === 'string' && /^https?:\/\//i.test(value)
      ? URL.parse(value)
      : null;
  if (!url) throw new Error('FARO_URL must be an absolute http(s) URL');
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

// AI assistants: the MCP server's address (the audience of an assistant's
// token), the identity server's realm, the assistant hosts it trusts, and the
// identity server's client at the api's sign-in routes.
export const ASSISTANT_ENV = [
  'MCP_URL',
  'ASSISTANT_ISSUER',
  'ASSISTANT_TRUSTED_DOMAINS',
  'ASSISTANT_BROKER_CLIENT_ID',
  'ASSISTANT_BROKER_CLIENT_SECRET',
  'ASSISTANT_BROKER_REDIRECT_URI',
] as const;

export interface AssistantSettings {
  mcpUrl: string;
  issuer: string;
  trustedDomains: string[];
  broker: { clientId: string; clientSecret: string; redirectUri: string };
}

export function assistantSettings(
  source: Record<string, string | undefined> = process.env,
): AssistantSettings {
  const env = readEnv(ASSISTANT_ENV, source);
  return {
    broker: {
      clientId: env.ASSISTANT_BROKER_CLIENT_ID,
      clientSecret: env.ASSISTANT_BROKER_CLIENT_SECRET,
      redirectUri: httpUrl(env, 'ASSISTANT_BROKER_REDIRECT_URI'),
    },
    issuer: httpUrl(env, 'ASSISTANT_ISSUER'),
    mcpUrl: httpUrl(env, 'MCP_URL'),
    trustedDomains: env.ASSISTANT_TRUSTED_DOMAINS.split(',')
      .map((domain) => domain.trim())
      .filter(Boolean),
  };
}

// Returned as written: the issuer and the audience are compared verbatim with
// the token's claims, so URL normalisation would break the match.
function httpUrl<K extends string>(env: Env<K>, name: K): string {
  const value = env[name];
  if (!/^https?:\/\//i.test(value) || !URL.canParse(value)) {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  return value;
}
