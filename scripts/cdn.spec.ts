// @traces 430-FR-001 430-FR-004 430-FR-005 430-FR-006 430-FR-008 430-FR-009
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from './cdn.ts';

const FILE = join(__dirname, '..', 'infra', 'cdn', 'bunny.json');
const config = JSON.parse(readFileSync(FILE, 'utf8'));

// The live heartbeat on the stream (live.hub.ts HEARTBEAT_MS).
const HEARTBEAT_SECONDS = 25;

const ENV = {
  BUNNY_API_KEY: 'key-123',
  BUNNY_PULL_ZONE_ID: '42',
  // The file by its own path: the pre-commit hook runs Jest from scripts/.
  CDN_CONFIG: FILE,
  CDN_ORIGIN_HOST: 'web-staging.up.railway.app',
  CDN_ORIGIN_URL: 'https://web-staging.up.railway.app',
  ORIGIN_SECRET_EDGE: 'edge-secret',
};

const urlRule = (patterns: string[]) => ({
  Parameter1: null,
  PatternMatches: patterns,
  PatternMatchingType: 0,
  Type: 0,
});

// A recorded `GET /pullzone/42`: the file's fields, its rules, and a few of
// Bunny's own defaults the file does not state.
const recorded = () => ({
  CacheControlMaxAgeOverride: -1,
  CacheErrorResponses: false,
  DisableCookies: false,
  EdgeRules: [
    {
      ActionParameter1: '0',
      ActionParameter2: null,
      ActionType: 3,
      Description: 'mf-no-cache-app-api',
      Enabled: true,
      Guid: 'guid-app-api',
      TriggerMatchingType: 0,
      Triggers: [urlRule(['*/api/*', '*/app/*'])],
    },
    {
      ActionParameter1: '0',
      ActionParameter2: null,
      ActionType: 3,
      Description: 'mf-no-cache-signed-in',
      Enabled: true,
      Guid: 'guid-signed-in',
      TriggerMatchingType: 0,
      Triggers: [
        {
          Parameter1: 'Cookie',
          PatternMatches: ['*mf_refresh*'],
          PatternMatchingType: 0,
          Type: 1,
        },
        {
          Parameter1: 'Authorization',
          PatternMatches: ['*'],
          PatternMatchingType: 0,
          Type: 1,
        },
      ],
    },
    {
      ActionParameter1: 'X-Origin-Secret',
      ActionParameter2: 'edge-secret',
      ActionType: 6,
      Description: 'mf-origin-secret',
      Enabled: true,
      Guid: 'guid-secret',
      TriggerMatchingType: 0,
      Triggers: [urlRule(['*'])],
    },
  ],
  EnableCookieVary: false,
  EnableGeoZoneAF: false,
  EnableGeoZoneASIA: false,
  EnableGeoZoneEU: true,
  EnableGeoZoneSA: false,
  EnableGeoZoneUS: false,
  EnableLogging: true,
  EnableRequestCoalescing: false,
  Hostnames: [
    {
      ForceSSL: true,
      HasCertificate: true,
      Id: 1,
      IsSystemHostname: true,
      Value: 'motorfix-staging.b-cdn.net',
    },
  ],
  Id: 42,
  Name: 'motorfix-staging',
  OriginHostHeader: 'web-staging.up.railway.app',
  OriginResponseTimeout: 60,
  OriginUrl: 'https://web-staging.up.railway.app',
});

type Sent = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal | null;
};

function fakeFetch(answers: { status: number; body?: unknown }[]) {
  const sent: Sent[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: { ...(init?.headers as Record<string, string>) },
      method: init?.method ?? 'GET',
      signal: init?.signal,
      url: String(url),
    });
    const answer = answers.shift();
    if (!answer) throw new Error('no recorded answer left');
    return new Response(
      answer.body === undefined ? null : JSON.stringify(answer.body),
      { status: answer.status },
    );
  }) as typeof fetch;
  return { impl, sent };
}

let lines: string[];

beforeEach(() => {
  lines = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  jest.spyOn(console, 'log').mockImplementation(capture);
  jest.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  // Neither the key nor the origin secret ever reaches the output.
  for (const line of lines) {
    expect(line).not.toContain('key-123');
    expect(line).not.toContain('edge-secret');
  }
  jest.restoreAllMocks();
});

const glob = (pattern: string) =>
  new RegExp(`^${pattern.split('*').map(literal).join('.*')}$`);
function literal(text: string) {
  return text.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
}

describe('infra/cdn/bunny.json', () => {
  const envs = ['staging', 'production'] as const;

  it('holds both environments and nothing that identifies the zone or its key', () => {
    expect(Object.keys(config.environments).sort()).toEqual([
      'production',
      'staging',
    ]);
    const text = readFileSync(FILE, 'utf8');
    expect(text).not.toMatch(/AccessKey|"Id"|PullZoneId|key-/i);
  });

  it.each(envs)(
    '%s: TLS only, plain HTTP redirected, an https origin',
    (env) => {
      const zone = config.environments[env];
      expect(zone.hostnames).toEqual({ ForceSSL: true });
      expect(zone.pullZone.OriginUrl).toBe('$CDN_ORIGIN_URL');
      expect(zone.pullZone.OriginHostHeader).toBe('$CDN_ORIGIN_HOST');
    },
  );

  it.each(envs)('%s: served from EU edges only', (env) => {
    const zone = config.environments[env].pullZone;
    expect(zone.EnableGeoZoneEU).toBe(true);
    for (const geo of ['US', 'ASIA', 'SA', 'AF']) {
      expect(zone[`EnableGeoZone${geo}`]).toBe(false);
    }
    expect(zone.CacheErrorResponses).toBe(false);
    expect(zone.DisableCookies).toBe(false);
    expect(zone.EnableCookieVary).toBe(false);
  });

  // @traces 1190-FR-012
  it.each(envs)('%s: never caches either live stream', (env) => {
    const rule = config.environments[env].edgeRules.find(
      (r: { Description: string }) => r.Description === 'mf-no-cache-app-api',
    );
    const patterns: string[] = rule.Triggers[0].PatternMatches;
    for (const url of [
      'https://motorfix.ro/api/v1/live',
      'https://motorfix.ro/api/v1/live/public?garages=x',
    ]) {
      expect(patterns.some((p) => glob(p).test(url))).toBe(true);
    }
  });

  it.each(envs)(
    '%s: never caches /api/, /app/ or a signed-in request',
    (env) => {
      const rules = config.environments[env].edgeRules;
      const byName = Object.fromEntries(
        rules.map((r: { Description: string }) => [r.Description, r]),
      );
      expect(byName['mf-no-cache-app-api']).toEqual({
        ActionParameter1: '0',
        ActionType: 'OverrideCacheTime',
        Description: 'mf-no-cache-app-api',
        TriggerMatchingType: 'Any',
        Triggers: [
          {
            PatternMatches: ['*/api/*', '*/app/*'],
            PatternMatchingType: 'Any',
            Type: 'Url',
          },
        ],
      });
      expect(byName['mf-no-cache-signed-in']).toEqual({
        ActionParameter1: '0',
        ActionType: 'OverrideCacheTime',
        Description: 'mf-no-cache-signed-in',
        TriggerMatchingType: 'Any',
        Triggers: [
          {
            Parameter1: 'Cookie',
            PatternMatches: ['*mf_refresh*'],
            PatternMatchingType: 'Any',
            Type: 'RequestHeader',
          },
          {
            Parameter1: 'Authorization',
            PatternMatches: ['*'],
            PatternMatchingType: 'Any',
            Type: 'RequestHeader',
          },
        ],
      });
      expect(byName['mf-origin-secret']).toEqual({
        ActionParameter1: 'X-Origin-Secret',
        ActionParameter2: '$ORIGIN_SECRET_EDGE',
        ActionType: 'SetRequestHeader',
        Description: 'mf-origin-secret',
        TriggerMatchingType: 'Any',
        Triggers: [
          { PatternMatches: ['*'], PatternMatchingType: 'Any', Type: 'Url' },
        ],
      });
    },
  );

  it.each(envs)(
    '%s: live streams pass uncached and stay open past a heartbeat',
    (env) => {
      const zone = config.environments[env];
      const appApi = zone.edgeRules.find(
        (r: { Description: string }) => r.Description === 'mf-no-cache-app-api',
      );
      const patterns: string[] = appApi.Triggers[0].PatternMatches;
      for (const url of [
        'https://motorfix.ro/api/v1/live',
        'https://motorfix.ro/api/v1/live/public',
      ]) {
        expect(patterns.some((p) => glob(p).test(url))).toBe(true);
      }
      expect(zone.pullZone.OriginResponseTimeout).toBeGreaterThanOrEqual(
        2 * HEARTBEAT_SECONDS,
      );
      // One origin stream per viewer: the edge never merges two requests.
      expect(zone.pullZone.EnableRequestCoalescing).toBe(false);
    },
  );

  it.each(envs)(
    '%s: managed rules on and two edge rate limits answering 429',
    (env) => {
      const shield = config.environments[env].shield;
      expect(shield.managedRules).toBe('basic');
      expect(shield.mode).toBe('block');
      expect(shield.rateLimits).toEqual([
        {
          method: 'POST',
          name: 'auth',
          paths: [
            '/api/v1/auth/sign-in',
            '/api/v1/auth/sign-up',
            '/api/v1/auth/phone-sign-in',
            '/api/v1/auth/phone-code',
            '/api/v1/auth/oauth/complete',
            '/api/v1/auth/password-reset*',
            '/api/v1/me/email',
            '/api/v1/me/phone*',
          ],
          per: 'client-ip',
          requestsPerMinute: 20,
          status: 429,
        },
        {
          method: 'POST',
          name: 'quote-requests',
          paths: ['/api/v1/quote-requests'],
          per: 'client-ip',
          requestsPerMinute: 10,
          status: 429,
        },
      ]);
    },
  );
});

describe('cdn check', () => {
  it('prints ok when the live zone matches the file', async () => {
    const { impl, sent } = fakeFetch([{ body: recorded(), status: 200 }]);
    const { ORIGIN_SECRET_EDGE: _, ...env } = ENV;
    expect(await run(['check', 'staging'], env, impl)).toBe(0);
    expect(lines).toContain('ok');
    expect(lines).toContain('shield: not checked');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      headers: { AccessKey: 'key-123' },
      method: 'GET',
      url: 'https://api.bunny.net/pullzone/42',
    });
    expect(sent[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('names every difference and exits 1', async () => {
    const live = recorded();
    live.OriginResponseTimeout = 30;
    delete (live as Partial<typeof live>).EnableCookieVary;
    live.Hostnames[0]!.ForceSSL = false;
    live.EdgeRules = live.EdgeRules.filter(
      (r) => r.Description !== 'mf-no-cache-signed-in',
    );
    live.EdgeRules.push({
      ...live.EdgeRules[0]!,
      Description: 'old-rule',
      Guid: 'guid-old',
    });
    live.EdgeRules[0]!.ActionParameter1 = '300';
    const { impl } = fakeFetch([{ body: live, status: 200 }]);
    expect(await run(['check', 'staging'], ENV, impl)).toBe(1);
    expect(lines).toEqual(
      expect.arrayContaining([
        'pullZone.OriginResponseTimeout: file 60, live 30',
        'pullZone.EnableCookieVary: unknown field',
        'hostname motorfix-staging.b-cdn.net ForceSSL: file true, live false',
        'rule mf-no-cache-app-api ActionParameter1: file 0, live 300',
        'rule mf-no-cache-signed-in: missing',
        'rule old-rule: extra',
        'shield: not checked',
      ]),
    );
    expect(lines).not.toContain('ok');
  });

  it('checks the origin secret by presence only', async () => {
    const live = recorded();
    live.EdgeRules[2]!.ActionParameter2 = 'another-value';
    const { impl } = fakeFetch([{ body: live, status: 200 }]);
    const { ORIGIN_SECRET_EDGE: _, ...env } = ENV;
    expect(await run(['check', 'staging'], env, impl)).toBe(0);

    live.EdgeRules[2]!.ActionParameter2 = '';
    const empty = fakeFetch([{ body: live, status: 200 }]);
    expect(await run(['check', 'staging'], env, empty.impl)).toBe(1);
    expect(lines).toContain(
      'rule mf-origin-secret ActionParameter2: file <set>, live <unset>',
    );
  });

  it('prints a provider error with its status and exits 1', async () => {
    const { impl } = fakeFetch([{ body: { Message: 'nope' }, status: 401 }]);
    expect(await run(['check', 'staging'], ENV, impl)).toBe(1);
    expect(lines.join('\n')).toContain('401');
  });
});

describe('cdn apply', () => {
  const drifted = () => {
    const live = recorded();
    live.OriginResponseTimeout = 30;
    live.Hostnames[0]!.ForceSSL = false;
    live.EdgeRules[0]!.ActionParameter1 = '300';
    live.EdgeRules[2]!.ActionParameter2 = 'old-secret';
    live.EdgeRules = live.EdgeRules.filter(
      (r) => r.Description !== 'mf-no-cache-signed-in',
    );
    live.EdgeRules.push({
      ...recorded().EdgeRules[0]!,
      Description: 'old-rule',
      Guid: 'guid-old',
    });
    return live;
  };

  it('sends only what differs, reuses each rule Guid and deletes the extra rule', async () => {
    const { impl, sent } = fakeFetch([
      { body: drifted(), status: 200 },
      { status: 204 },
      { status: 200 },
      { status: 200 },
      { status: 200 },
      { status: 204 },
      { status: 204 },
      { body: recorded(), status: 200 },
    ]);
    expect(await run(['apply', 'staging'], ENV, impl)).toBe(0);
    const base = 'https://api.bunny.net/pullzone/42';
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      `GET ${base}`,
      `POST ${base}`,
      `POST ${base}/edgerules/addOrUpdate`,
      `POST ${base}/edgerules/addOrUpdate`,
      `POST ${base}/edgerules/addOrUpdate`,
      `DELETE ${base}/edgerules/guid-old`,
      `POST ${base}/setForceSSL`,
      `GET ${base}`,
    ]);
    expect(sent[1]?.body).toEqual({ OriginResponseTimeout: 60 });
    expect(sent[2]?.body).toMatchObject({
      ActionParameter1: '0',
      ActionType: 3,
      Description: 'mf-no-cache-app-api',
      Enabled: true,
      Guid: 'guid-app-api',
      TriggerMatchingType: 0,
      Triggers: [
        {
          PatternMatches: ['*/api/*', '*/app/*'],
          PatternMatchingType: 0,
          Type: 0,
        },
      ],
    });
    expect(sent[3]?.body).toMatchObject({
      Description: 'mf-no-cache-signed-in',
      Triggers: [
        { Parameter1: 'Cookie', Type: 1 },
        { Parameter1: 'Authorization', Type: 1 },
      ],
    });
    expect(sent[3]?.body).not.toHaveProperty('Guid');
    expect(sent[4]?.body).toMatchObject({
      ActionParameter1: 'X-Origin-Secret',
      ActionParameter2: 'edge-secret',
      ActionType: 6,
      Guid: 'guid-secret',
    });
    expect(sent[6]?.body).toEqual({
      ForceSSL: true,
      Hostname: 'motorfix-staging.b-cdn.net',
    });
    for (const call of sent) {
      expect(call.headers['AccessKey']).toBe('key-123');
    }
    expect(lines).toContain('ok');
  });

  it('calls nothing but the reads when the zone already matches', async () => {
    const { impl, sent } = fakeFetch([
      { body: recorded(), status: 200 },
      { body: recorded(), status: 200 },
    ]);
    expect(await run(['apply', 'staging'], ENV, impl)).toBe(0);
    expect(sent.map((s) => s.method)).toEqual(['GET', 'GET']);
  });

  it('stops at a refused call and exits 1 with its status', async () => {
    const { impl, sent } = fakeFetch([
      { body: drifted(), status: 200 },
      { body: { Message: 'bad field' }, status: 400 },
    ]);
    expect(await run(['apply', 'staging'], ENV, impl)).toBe(1);
    expect(sent).toHaveLength(2);
    expect(lines.join('\n')).toMatch(/400.*bad field/);
  });

  it('refuses a plain http origin before calling the provider', async () => {
    const { impl, sent } = fakeFetch([]);
    const env = { ...ENV, CDN_ORIGIN_URL: 'http://web-staging.up.railway.app' };
    expect(await run(['apply', 'staging'], env, impl)).toBe(2);
    expect(sent).toHaveLength(0);
    expect(lines.join('\n')).toContain('OriginUrl');
  });
});

describe('cdn purge', () => {
  it('purges the whole zone with no body', async () => {
    const { impl, sent } = fakeFetch([{ status: 204 }]);
    expect(await run(['purge', '--zone'], ENV, impl)).toBe(0);
    expect(sent).toEqual([
      expect.objectContaining({
        body: undefined,
        method: 'POST',
        url: 'https://api.bunny.net/pullzone/42/purgeCache',
      }),
    ]);
  });

  it('purges one tag per call, in order', async () => {
    const { impl, sent } = fakeFetch([{ status: 204 }, { status: 204 }]);
    expect(await run(['purge', 'garage:g-1', 'search'], ENV, impl)).toBe(0);
    expect(sent.map((s) => s.body)).toEqual([
      { CacheTag: 'garage:g-1' },
      { CacheTag: 'search' },
    ]);
    expect(sent[0]?.headers['AccessKey']).toBe('key-123');
  });

  it('lists the tags it could not purge and exits 1', async () => {
    const { impl } = fakeFetch([{ status: 204 }, { status: 429 }]);
    expect(await run(['purge', 'garage:g-1', 'search'], ENV, impl)).toBe(1);
    expect(lines).toContain('purge failed: search');
  });
});

describe('cdn input', () => {
  it('names every missing variable and exits 2 without a call', async () => {
    const { impl, sent } = fakeFetch([]);
    expect(await run(['check', 'staging'], { CDN_CONFIG: FILE }, impl)).toBe(2);
    expect(lines.join('\n')).toMatch(/BUNNY_API_KEY/);
    expect(lines.join('\n')).toMatch(/BUNNY_PULL_ZONE_ID/);
    expect(lines.join('\n')).toMatch(/CDN_ORIGIN_URL/);
    expect(sent).toHaveLength(0);
  });

  it('needs the origin secret to apply', async () => {
    const { impl } = fakeFetch([]);
    const { ORIGIN_SECRET_EDGE: _, ...env } = ENV;
    expect(await run(['apply', 'staging'], env, impl)).toBe(2);
    expect(lines.join('\n')).toContain('ORIGIN_SECRET_EDGE');
  });

  it('refuses an unknown environment or command', async () => {
    const { impl } = fakeFetch([]);
    expect(await run(['check', 'dev'], ENV, impl)).toBe(2);
    expect(await run(['deploy'], ENV, impl)).toBe(2);
    expect(await run([], ENV, impl)).toBe(2);
  });

  it('names the path of a bad key in the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdn-'));
    const file = join(dir, 'bunny.json');
    const bad = structuredClone(config);
    delete bad.environments.staging.edgeRules[0].Description;
    bad.environments.staging.edgeRules[1].ActionType = 'Nope';
    writeFileSync(file, JSON.stringify(bad));
    const { impl, sent } = fakeFetch([]);
    expect(
      await run(['check', 'staging'], { ...ENV, CDN_CONFIG: file }, impl),
    ).toBe(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        'environments.staging.edgeRules[0].Description: missing',
        'environments.staging.edgeRules[1].ActionType: unknown Nope',
      ]),
    );
    expect(sent).toHaveLength(0);
  });
});
