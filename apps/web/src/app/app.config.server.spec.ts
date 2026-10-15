import type { ApplicationConfig } from '@angular/core';

// @traces 1200-transfer-cache-origin-FR-002

type Provider = { provide?: unknown; useValue?: unknown };

const flatten = (providers: unknown[]): Provider[] =>
  providers.flatMap((p) => (Array.isArray(p) ? flatten(p) : [p as Provider]));

// The origin-map providers the server config gives for these variables.
async function serverConfig(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete process.env[key];
  try {
    // The module registry is fresh, so the token is the one it provides.
    let config: ApplicationConfig | undefined;
    let token: unknown;
    await jest.isolateModulesAsync(async () => {
      ({ config } = await import('./app.config.server'));
      token = (await import('@angular/common/http'))
        .HTTP_TRANSFER_CACHE_ORIGIN_MAP;
    });
    return flatten((config as ApplicationConfig).providers).filter(
      (p) => p.provide === token,
    );
  } finally {
    process.env = saved;
  }
}

describe('the server app config', () => {
  it("maps the API's private origin onto the public web origin", async () => {
    const providers = await serverConfig({
      API_INTERNAL_URL: 'http://api.internal:3000',
      PUBLIC_WEB_URL: 'http://web.test',
    });

    expect(providers).toEqual([
      expect.objectContaining({
        useValue: { 'http://api.internal:3000': 'http://web.test' },
      }),
    ]);
  });

  it('maps origins only, never a path the addresses carry', async () => {
    const providers = await serverConfig({
      API_INTERNAL_URL: 'http://api.internal:3000/',
      PUBLIC_WEB_URL: 'https://motorfix.ro/ro',
    });

    expect(providers[0]?.useValue).toEqual({
      'http://api.internal:3000': 'https://motorfix.ro',
    });
  });

  it('provides no origin map without a public web address', async () => {
    const providers = await serverConfig({
      API_INTERNAL_URL: 'http://api.internal:3000',
      PUBLIC_WEB_URL: undefined,
    });

    expect(providers).toEqual([]);
  });
});
