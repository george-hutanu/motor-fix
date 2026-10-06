import {
  APPLE_ENV,
  type AppEnv,
  GOOGLE_ENV,
  type OAuthProvider,
} from '@motor-fix/contracts';

export interface ProviderSettings {
  provider: OAuthProvider;
  clientId: string;
  clientSecret?: string;
  // Where discovery starts.
  issuer: string;
  // What an ID token's `iss` may say: Google signs some without the scheme.
  issuers: string[];
  redirectUri: string;
  apple?: { teamId: string; keyId: string; privateKey: string };
}

export type OAuthSettings = Partial<Record<OAuthProvider, ProviderSettings>>;

const ISSUERS: Record<OAuthProvider, string[]> = {
  apple: ['https://appleid.apple.com'],
  google: ['https://accounts.google.com', 'accounts.google.com'],
};

const OVERRIDE: Record<OAuthProvider, string> = {
  apple: 'APPLE_ISSUER',
  google: 'GOOGLE_ISSUER',
};

const STAND_IN_ALLOWED: readonly AppEnv[] = ['development', 'test'];

const withoutSlash = (url: string) => url.replace(/\/+$/, '');

// A provider is offered only when every one of its keys is set.
export function oauthSettings(
  appEnv: AppEnv,
  source: Record<string, string | undefined>,
): OAuthSettings {
  const read = (name: string) => {
    const value = Object.hasOwn(source, name) ? source[name] : undefined;
    return value?.trim() ? value : undefined;
  };
  const web = read('PUBLIC_WEB_URL');
  if (!web) return {};
  const issuersOf = (provider: OAuthProvider) => {
    const override = STAND_IN_ALLOWED.includes(appEnv)
      ? read(OVERRIDE[provider])
      : undefined;
    return override ? [withoutSlash(override.trim())] : [...ISSUERS[provider]];
  };
  const base = (provider: OAuthProvider) => {
    const issuers = issuersOf(provider);
    return {
      issuer: issuers[0],
      issuers,
      provider,
      redirectUri: `${withoutSlash(web.trim())}/api/v1/auth/oauth/${provider}/callback`,
    };
  };
  const settings: OAuthSettings = {};
  if (GOOGLE_ENV.every(read)) {
    settings.google = {
      ...base('google'),
      clientId: (read('GOOGLE_CLIENT_ID') ?? '').trim(),
      clientSecret: (read('GOOGLE_CLIENT_SECRET') ?? '').trim(),
    };
  }
  if (APPLE_ENV.every(read)) {
    settings.apple = {
      ...base('apple'),
      apple: {
        keyId: (read('APPLE_KEY_ID') ?? '').trim(),
        privateKey: (read('APPLE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n'),
        teamId: (read('APPLE_TEAM_ID') ?? '').trim(),
      },
      clientId: (read('APPLE_SERVICES_ID') ?? '').trim(),
    };
  }
  return settings;
}
