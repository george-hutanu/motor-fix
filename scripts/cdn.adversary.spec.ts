// @traces 430-FR-001 430-FR-004 430-FR-008 430-FR-009
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from './cdn.ts';

const FILE = join(__dirname, '..', 'infra', 'cdn', 'bunny.json');
const config = JSON.parse(readFileSync(FILE, 'utf8'));

const ENV = {
  BUNNY_API_KEY: 'key-123',
  BUNNY_PULL_ZONE_ID: '42',
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

const recorded = () => ({
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
  EnableRequestCoalescing: false,
  Hostnames: [
    {
      ForceSSL: true,
      Id: 1,
      Value: 'motorfix-staging.b-cdn.net',
    },
  ],
  Id: 42,
  OriginHostHeader: 'web-staging.up.railway.app',
  OriginResponseTimeout: 60,
  OriginUrl: 'https://web-staging.up.railway.app',
});

type Answer =
  | { status: number; body?: unknown; raw?: string }
  | { throws: unknown };

function fakeFetch(answers: Answer[]) {
  const sent: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal | null;
    at: number;
  }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      at: Date.now(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: { ...(init?.headers as Record<string, string>) },
      method: init?.method ?? 'GET',
      signal: init?.signal,
      url: String(url),
    });
    const answer = answers.shift();
    if (!answer) throw new Error('no recorded answer left');
    if ('throws' in answer) throw answer.throws;
    const text =
      answer.raw ??
      (answer.body === undefined ? null : JSON.stringify(answer.body));
    return new Response(text, { status: answer.status });
  }) as typeof fetch;
  return { impl, sent };
}

let lines: string[];
const dirs: string[] = [];

beforeEach(() => {
  lines = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  jest.spyOn(console, 'log').mockImplementation(capture);
  jest.spyOn(console, 'error').mockImplementation(capture);
  jest.spyOn(console, 'warn').mockImplementation(capture);
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

function leaks() {
  return lines.filter(
    (line) => line.includes('key-123') || line.includes('edge-secret'),
  );
}

function configFile(edit: (c: typeof config) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'cdn-adv-'));
  dirs.push(dir);
  const file = join(dir, 'bunny.json');
  const copy = structuredClone(config);
  const text = edit(copy);
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(copy));
  return file;
}

const noSecret = (() => {
  const { ORIGIN_SECRET_EDGE: _, ...rest } = ENV;
  return rest;
})();

describe('cdn arguments', () => {
  it.each([
    [['check', 'staging', 'production']],
    [['check']],
    [['apply']],
    [['check', '__proto__']],
    [['check', 'constructor']],
    [['check', 'Staging']],
    [['check', '']],
    [['purge']],
    [['purge', '--zone', 'search']],
    [['purge', '--bogus']],
    [['purge', '']],
    [['PURGE', '--zone']],
  ])('refuses %j with exit 2 and no call', async (argv) => {
    const { impl, sent } = fakeFetch([]);

    expect(await run(argv, ENV, impl)).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it.each([['BUNNY_API_KEY'], ['BUNNY_PULL_ZONE_ID']])(
    'treats an empty %s as missing',
    async (name) => {
      const { impl, sent } = fakeFetch([]);

      expect(
        await run(['purge', '--zone'], { ...ENV, [name]: '  ' }, impl),
      ).toBe(2);
      expect(lines.join('\n')).toContain(name);
      expect(sent).toHaveLength(0);
    },
  );

  it('refuses a pull zone that would change the address called', async () => {
    const { impl, sent } = fakeFetch([{ status: 204 }]);

    const code = await run(
      ['purge', '--zone'],
      { ...ENV, BUNNY_PULL_ZONE_ID: '42/../../other' },
      impl,
    );

    expect(code).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it.each(['HTTP://web.example', 'ftp://web.example', 'web.example', ''])(
    'refuses the origin address %j before calling the provider',
    async (url) => {
      const { impl, sent } = fakeFetch([]);

      expect(
        await run(['apply', 'staging'], { ...ENV, CDN_ORIGIN_URL: url }, impl),
      ).toBe(2);
      expect(sent).toHaveLength(0);
    },
  );
});

describe('cdn configuration file', () => {
  it.each([
    ['not json', () => '{nope'],
    ['empty', () => ''],
    ['an array', () => '[]'],
    ['null', () => 'null'],
    ['no environments', () => '{}'],
  ])('exits 2 for a file that is %s', async (_name, edit) => {
    const file = configFile(edit);
    const { impl, sent } = fakeFetch([]);

    expect(
      await run(['check', 'staging'], { ...ENV, CDN_CONFIG: file }, impl),
    ).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it('exits 2 for a missing file', async () => {
    const { impl } = fakeFetch([]);

    expect(
      await run(
        ['check', 'staging'],
        { ...ENV, CDN_CONFIG: join(tmpdir(), 'cdn-nope', 'bunny.json') },
        impl,
      ),
    ).toBe(2);
  });

  it('names the path when pullZone is missing', async () => {
    const file = configFile((c) => {
      delete c.environments.staging.pullZone;
    });
    const { impl } = fakeFetch([]);

    expect(
      await run(['check', 'staging'], { ...ENV, CDN_CONFIG: file }, impl),
    ).toBe(2);
    expect(lines.join('\n')).toContain('environments.staging.pullZone');
  });

  it('exits 2 for a rule with an empty description', async () => {
    const file = configFile((c) => {
      c.environments.staging.edgeRules[0].Description = '';
    });
    const { impl } = fakeFetch([]);

    expect(
      await run(['check', 'staging'], { ...ENV, CDN_CONFIG: file }, impl),
    ).toBe(2);
    expect(lines.join('\n')).toContain(
      'environments.staging.edgeRules[0].Description',
    );
  });

  it.each(['TriggerMatchingType', 'ActionType'])(
    'exits 2 for an unknown %s',
    async (key) => {
      const file = configFile((c) => {
        c.environments.staging.edgeRules[0][key] = 'Bogus';
      });
      const { impl } = fakeFetch([]);

      expect(
        await run(['check', 'staging'], { ...ENV, CDN_CONFIG: file }, impl),
      ).toBe(2);
      expect(lines.join('\n')).toContain(`edgeRules[0].${key}`);
    },
  );

  it('exits 2 naming a variable the file reads and the environment lacks', async () => {
    const file = configFile((c) => {
      c.environments.staging.pullZone.OriginHostHeader = '$NOPE_VARIABLE';
    });
    const { impl, sent } = fakeFetch([]);

    expect(
      await run(['check', 'staging'], { ...ENV, CDN_CONFIG: file }, impl),
    ).toBe(2);
    expect(lines.join('\n')).toContain('NOPE_VARIABLE');
    expect(sent).toHaveLength(0);
  });
});

describe('cdn check against odd answers', () => {
  it.each([
    ['text that is not json', { raw: 'Bad Gateway', status: 200 }],
    ['an html error page', { raw: '<html>502</html>', status: 502 }],
    ['null', { raw: 'null', status: 200 }],
    ['an array', { raw: '[]', status: 200 }],
    ['an empty body', { status: 200 }],
    ['an object with no rules', { body: {}, status: 200 }],
    ['rules that are not a list', { body: { EdgeRules: 'x' }, status: 200 }],
  ] as [string, Answer][])('exits 1 for %s', async (_name, answer) => {
    const { impl } = fakeFetch([answer]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
    expect(lines).not.toContain('ok');
  });

  it.each([
    ['a refused connection', new Error('ECONNREFUSED')],
    ['a timeout', new DOMException('timed out', 'TimeoutError')],
    ['a thrown string', 'boom'],
  ])('exits 1 for %s, on every command', async (_name, error) => {
    for (const argv of [
      ['check', 'staging'],
      ['apply', 'staging'],
      ['purge', '--zone'],
      ['purge', 'search'],
    ]) {
      const { impl } = fakeFetch([{ throws: error }]);

      expect(await run(argv, ENV, impl)).toBe(1);
    }
  });

  it('fails a live rule that is switched off', async () => {
    const live = recorded();
    live.EdgeRules[0]!.Enabled = false;
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('fails a live rule whose patterns changed', async () => {
    const live = recorded();
    live.EdgeRules[0]!.Triggers[0]!.PatternMatches = ['*/api/*'];
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('fails a live rule that lost a trigger', async () => {
    const live = recorded();
    live.EdgeRules[1]!.Triggers.pop();
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('fails a live rule that matches all triggers instead of any', async () => {
    const live = recorded();
    live.EdgeRules[1]!.TriggerMatchingType = 1;
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('fails a live rule whose action changed', async () => {
    const live = recorded();
    live.EdgeRules[0]!.ActionType = 4;
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('fails a second live rule with the same description', async () => {
    const live = recorded();
    live.EdgeRules.push({ ...live.EdgeRules[0]!, Guid: 'guid-dup' });
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('fails a custom hostname that serves plain http', async () => {
    const live = recorded();
    live.Hostnames.push({ ForceSSL: false, Id: 2, Value: 'motorfix.ro' });
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
    expect(lines.join('\n')).toContain('motorfix.ro');
  });

  it.each([
    ['EnableGeoZoneEU', null],
    ['EnableGeoZoneEU', 'true'],
    ['EnableGeoZoneEU', 1],
    ['OriginResponseTimeout', '60'],
    ['EnableGeoZoneUS', 0],
  ])('does not take %s = %j for the file value', async (field, value) => {
    const live = recorded() as Record<string, unknown>;
    live[field] = value;
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
    expect(lines.join('\n')).toContain(`pullZone.${field}`);
  });

  it('fails when the origin address differs by case or a trailing slash', async () => {
    const live = recorded();
    live.OriginUrl = 'https://web-staging.up.railway.app/';
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
  });

  it('prints the same lines for the same answer twice', async () => {
    const live = recorded();
    live.OriginResponseTimeout = 1;
    live.EdgeRules.pop();
    const first = fakeFetch([{ body: live, status: 200 }]);
    await run(['check', 'staging'], noSecret, first.impl);
    const one = [...lines];
    lines.length = 0;
    const second = fakeFetch([{ body: live, status: 200 }]);
    await run(['check', 'staging'], noSecret, second.impl);

    expect(lines).toEqual(one);
  });

  it('lists thousands of extra rules without failing', async () => {
    const live = recorded();
    for (let i = 0; i < 5_000; i += 1) {
      live.EdgeRules.push({
        ...live.EdgeRules[0]!,
        Description: `x${i}`,
        Guid: `g${i}`,
      });
    }
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    expect(await run(['check', 'staging'], noSecret, impl)).toBe(1);
    expect(lines).toContain('rule x4999: extra');
  });
});

describe('cdn apply against odd answers', () => {
  it('creates every rule without a Guid on an empty zone and deletes nothing', async () => {
    const live = recorded();
    live.EdgeRules = [];
    const { impl, sent } = fakeFetch([
      { body: live, status: 200 },
      { status: 200 },
      { status: 200 },
      { status: 200 },
      { body: recorded(), status: 200 },
    ]);

    expect(await run(['apply', 'staging'], ENV, impl)).toBe(0);
    const adds = sent.filter((s) => s.url.endsWith('/edgerules/addOrUpdate'));
    expect(adds).toHaveLength(3);
    for (const add of adds) expect(add.body).not.toHaveProperty('Guid');
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
  });

  it('exits 1 when the zone still differs after the changes were sent', async () => {
    const live = recorded();
    live.OriginResponseTimeout = 30;
    const { impl } = fakeFetch([
      { body: live, status: 200 },
      { status: 204 },
      { body: live, status: 200 },
    ]);

    expect(await run(['apply', 'staging'], ENV, impl)).toBe(1);
    expect(lines).not.toContain('ok');
  });

  it('sends the edge secret as it is, even when it looks like a variable', async () => {
    const live = recorded();
    live.EdgeRules[2]!.ActionParameter2 = 'old';
    const { impl, sent } = fakeFetch([
      { body: live, status: 200 },
      { status: 200 },
      { body: recorded(), status: 200 },
    ]);

    await run(
      ['apply', 'staging'],
      { ...ENV, ORIGIN_SECRET_EDGE: '$CDN_ORIGIN_URL' },
      impl,
    );

    expect(sent[1]?.body).toMatchObject({
      ActionParameter2: '$CDN_ORIGIN_URL',
    });
  });

  it('never prints the key or the secret when the provider echoes them', async () => {
    const live = recorded();
    live.EdgeRules[2]!.ActionParameter2 = 'old';
    const { impl } = fakeFetch([
      { body: live, status: 200 },
      {
        body: { Message: 'bad value edge-secret for AccessKey key-123' },
        status: 400,
      },
    ]);

    expect(await run(['apply', 'staging'], ENV, impl)).toBe(1);
    expect(leaks()).toEqual([]);
  });

  it('never prints the key or the secret when the call throws their text', async () => {
    for (const argv of [
      ['check', 'staging'],
      ['apply', 'staging'],
      ['purge', '--zone'],
    ]) {
      await run(
        argv,
        ENV,
        fakeFetch([
          { throws: new Error('failed with key-123 and edge-secret') },
        ]).impl,
      );
    }
    expect(leaks()).toEqual([]);
  });

  it('never prints the secret in a diff of a rule that holds a different one', async () => {
    const live = recorded();
    live.EdgeRules[2]!.ActionParameter2 = 'edge-secret-old';
    const { impl } = fakeFetch([{ body: live, status: 200 }]);

    await run(['check', 'staging'], ENV, impl);

    expect(lines.filter((l) => l.includes('edge-secret'))).toEqual([]);
  });

  it('gives every call a timeout signal', async () => {
    const live = recorded();
    live.OriginResponseTimeout = 30;
    live.EdgeRules.pop();
    live.EdgeRules.push({
      ...live.EdgeRules[0]!,
      Description: 'old',
      Guid: 'g',
    });
    const { impl, sent } = fakeFetch([
      { body: live, status: 200 },
      { status: 204 },
      { status: 200 },
      { status: 204 },
      { body: recorded(), status: 200 },
    ]);

    await run(['apply', 'staging'], ENV, impl);

    expect(sent.length).toBeGreaterThanOrEqual(4);
    for (const call of sent) expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('applies production with the same variables and the same zone', async () => {
    const { impl, sent } = fakeFetch([
      { body: recorded(), status: 200 },
      { body: recorded(), status: 200 },
    ]);

    expect(await run(['apply', 'production'], ENV, impl)).toBe(0);
    expect(sent[0]?.url).toBe('https://api.bunny.net/pullzone/42');
  });
});

describe('cdn purge against odd answers', () => {
  it('waits at least 100 ms between tags', async () => {
    const { impl, sent } = fakeFetch([
      { status: 204 },
      { status: 204 },
      { status: 204 },
    ]);

    await run(['purge', 'a', 'b', 'c'], ENV, impl);

    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(95);
    expect(sent[2]!.at - sent[1]!.at).toBeGreaterThanOrEqual(95);
  });

  it('keeps going after a failed tag and lists only the failed ones', async () => {
    const { impl, sent } = fakeFetch([
      { status: 429 },
      { status: 204 },
      { status: 500 },
    ]);

    expect(await run(['purge', 'a', 'b', 'c'], ENV, impl)).toBe(1);
    expect(sent).toHaveLength(3);
    expect(lines.filter((l) => l.startsWith('purge failed'))).toEqual([
      'purge failed: a',
      'purge failed: c',
    ]);
  });

  it('lists a tag whose call threw as failed too', async () => {
    const { impl } = fakeFetch([
      { throws: new Error('reset') },
      { status: 204 },
    ]);

    expect(await run(['purge', 'a', 'b'], ENV, impl)).toBe(1);
    expect(lines.join('\n')).toContain('a');
    expect(lines.join('\n')).not.toMatch(/purge failed:.*\bb\b/);
  });

  it('sends the zone purge with the key and a timeout', async () => {
    const { impl, sent } = fakeFetch([{ status: 200 }]);

    expect(await run(['purge', '--zone'], ENV, impl)).toBe(0);
    expect(sent[0]?.headers['AccessKey']).toBe('key-123');
    expect(sent[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 429, 500])(
    'exits 1 when the zone purge answers %i',
    async (status) => {
      const { impl } = fakeFetch([{ status }]);

      expect(await run(['purge', '--zone'], ENV, impl)).toBe(1);
      expect(lines.join('\n')).toContain(String(status));
    },
  );

  it('sends a tag with quotes and unicode as data', async () => {
    const { impl, sent } = fakeFetch([{ status: 204 }]);

    await run(['purge', 'garage:"é"'], ENV, impl);

    expect(sent[0]?.body).toEqual({ CacheTag: 'garage:"é"' });
  });

  it('purges the same tag twice when it is given twice', async () => {
    const { impl, sent } = fakeFetch([{ status: 204 }, { status: 204 }]);

    expect(await run(['purge', 'search', 'search'], ENV, impl)).toBe(0);
    expect(sent.map((s) => s.body)).toEqual([
      { CacheTag: 'search' },
      { CacheTag: 'search' },
    ]);
  });
});
