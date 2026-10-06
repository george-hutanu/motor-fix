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
