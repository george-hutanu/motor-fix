import type { ApplicationConfig } from '@angular/core';

// @traces 1200-transfer-cache-origin-FR-002

type Provider = { provide?: unknown; useValue?: unknown };

const flatten = (providers: unknown[]): Provider[] =>
  providers.flatMap((p) => (Array.isArray(p) ? flatten(p) : [p as Provider]));

// The origin-map providers the server config gives for these variables.
async function serverConfig(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

const api = 'http://api.internal:3000';

describe('the server origin map with odd addresses', () => {
  it.each([
    ['https://web.test/', 'https://web.test'],
    ['https://web.test:8443/a/b?q=1#h', 'https://web.test:8443'],
    ['HTTPS://Web.TEST', 'https://web.test'],
    ['https://web.test:443', 'https://web.test'],
    ['https://user:secret@web.test', 'https://web.test'],
  ])('maps the public address %s onto the origin %s', async (web, origin) => {
    const providers = await serverConfig({
      API_INTERNAL_URL: api,
      PUBLIC_WEB_URL: web,
    });

    expect(providers).toHaveLength(1);
    expect(providers[0]?.useValue).toEqual({ [api]: origin });
  });

  it.each([
    ['http://api.internal:3000/', 'http://api.internal:3000'],
    ['http://API.internal:3000/v1/x?y=1', 'http://api.internal:3000'],
    ['http://api.internal:80', 'http://api.internal'],
    ['http://svc:pw@api.internal:3000', 'http://api.internal:3000'],
  ])('keys the private address %s by the origin %s', async (internal, key) => {
    const providers = await serverConfig({
      API_INTERNAL_URL: internal,
      PUBLIC_WEB_URL: 'https://web.test',
    });

    expect(providers[0]?.useValue).toEqual({ [key]: 'https://web.test' });
  });

  it.each([['']])('provides no map for a public address of %j', async (web) => {
    const providers = await serverConfig({
      API_INTERNAL_URL: api,
      PUBLIC_WEB_URL: web,
    });

    expect(providers).toEqual([]);
  });

  it.each([['not a url'], ['web.test'], ['//web.test'], ['http://'], ['   ']])(
    'refuses to load for the invalid public address %j',
    async (web) => {
      await expect(
        serverConfig({ API_INTERNAL_URL: api, PUBLIC_WEB_URL: web }),
      ).rejects.toThrow('PUBLIC_WEB_URL must be an absolute URL');
    },
  );
});
