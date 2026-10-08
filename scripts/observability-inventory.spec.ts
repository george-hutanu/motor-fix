import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  checkInventory,
  writeEndpointCount,
} from './observability-inventory.ts';

type Entry = Record<string, unknown>;

const NONE = { alerts: 'none', dashboard: 'none', reason: 'added later' };

const listed: Entry[] = [
  { kind: 'app', name: 'api', source: 'apps/api' },
  { kind: 'railway-service', name: 'api', source: 'scripts/railway-deploy.ts' },
  {
    kind: 'queue',
    name: 'mail',
    source: 'libs/domain/src/mail/mail.module.ts',
  },
  {
    host: 'api.mailer.eu',
    kind: 'outside-service',
    name: 'mailer',
    source: 'libs/domain/src/mail/mail.module.ts',
  },
  {
    client: 's3',
    kind: 'outside-service',
    name: 's3',
    source: 'libs/domain/src/storage/storage.ts',
  },
  {
    kind: 'outside-service',
    name: 'postgresql',
    source: 'libs/contracts/env.ts',
  },
].map((entry) => ({ ...entry, ...NONE, story: 'ST-1' }));

let root: string;

function put(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function inventory(entries: Entry[], count = 2) {
  put(
    'infra/observability/inventory.json',
    JSON.stringify({
      endpoints: { count, source: 'apps/api/openapi.json' },
      entries,
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'observability-inventory-'));
  put(
    'apps/api/openapi.json',
    JSON.stringify({
      paths: { '/a': { get: {}, post: {} }, '/b': { parameters: [] } },
    }),
  );
  put(
    'scripts/railway-deploy.ts',
    "const options = { services: ['api'].map((name) => ({ name })) };\n",
  );
  put(
    'libs/domain/src/mail/mail.module.ts',
    [
      "export const MAIL_QUEUE = 'mail';",
      'const queue = new Queue(MAIL_QUEUE, { connection });',
      "const base = 'https://api.mailer.eu/v3';",
      "const link = 'https://motorfix.example/garages';",
      'const relayed = new Queue(name, { connection });',
    ].join('\n'),
  );
  put(
    'libs/domain/src/storage/storage.ts',
    'this.s3 = new S3Client({ region });\n',
  );
  put('libs/contracts/env.ts', 'export const env = {};\n');
  put(
    'libs/domain/src/mail/mail.spec.ts',
    "new Queue('spec-only'); fetch('https://spec.only.eu');\n",
  );
  put(
    'libs/data-access/src/request-builder.ts',
    '// see https://github.com/generated\n',
  );
  inventory(listed);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('checkInventory', () => {
  it('passes when every app, service, queue and outside client is listed', () => {
    expect(checkInventory(root)).toEqual([]);
  });

  it('names an app that is not listed', () => {
    put('apps/billing/project.json', '{}');
    expect(checkInventory(root)).toEqual([
      'missing app billing (apps/billing)',
    ]);
  });

  it('names a Railway service that is not listed', () => {
    put(
      'scripts/railway-deploy.ts',
      "const options = { services: ['api', 'worker'].map((name) => ({ name })) };\n",
    );
    expect(checkInventory(root)).toEqual([
      'missing railway-service worker (scripts/railway-deploy.ts)',
    ]);
  });

  it('names a queue that is not listed, from a literal or an exported constant', () => {
    put(
      'apps/worker/src/jobs.ts',
      "registerQueue('invoices');\nexport const consumer = { queue: NEWS_QUEUE };\nexport const NEWS_QUEUE = 'news';\n",
    );
    inventory([
      ...listed,
      {
        ...NONE,
        kind: 'app',
        name: 'worker',
        source: 'apps/worker',
        story: 'ST-1',
      },
    ]);
    expect(checkInventory(root)).toEqual([
      'missing queue invoices (apps/worker/src/jobs.ts)',
      'missing queue news (apps/worker/src/jobs.ts)',
    ]);
  });

  it('names an outside host or SDK client that is not listed', () => {
    put(
      'libs/domain/src/sms/sms.ts',
      "const url = 'https://api.sms.ro/send';\nimport { sendNotification } from 'web-push';\n",
    );
    expect(checkInventory(root)).toEqual([
      'missing outside-service api.sms.ro (libs/domain/src/sms/sms.ts)',
      'missing outside-service web-push (libs/domain/src/sms/sms.ts)',
    ]);
  });

  it('names a stale entry of a discovered kind and a hand-listed entry whose source is gone', () => {
    rmSync(join(root, 'libs/domain/src/storage'), { recursive: true });
    rmSync(join(root, 'libs/contracts/env.ts'));
    expect(checkInventory(root)).toEqual([
      'stale outside-service s3',
      'stale outside-service postgresql',
    ]);
  });

  it('fails on an endpoint count that differs from the OpenAPI operations', () => {
    inventory(listed, 5);
    expect(checkInventory(root)).toEqual([
      'endpoints: inventory says 5, openapi.json has 2 (run --write)',
    ]);
  });

  it('names a dashboard or alert uid that no Grafana file declares', () => {
    inventory([
      {
        ...listed[0],
        alerts: ['api-errors'],
        dashboard: 'api-overview',
        reason: undefined,
      },
      ...listed.slice(1),
    ]);
    expect(checkInventory(root)).toEqual([
      'app api: dashboard api-overview is not declared',
      'app api: alert api-errors is not declared',
    ]);
  });

  it('accepts uids declared by dashboard and alert JSON anywhere under infra/observability', () => {
    put(
      'infra/observability/grafana/dashboards/api.json',
      JSON.stringify({ title: 'API', uid: 'api-overview' }),
    );
    put(
      'infra/observability/alerts/api.json',
      JSON.stringify({
        apiVersion: 1,
        groups: [
          { name: 'api', rules: [{ title: 'Errors', uid: 'api-errors' }] },
        ],
      }),
    );
    inventory([
      {
        ...listed[0],
        alerts: ['api-errors'],
        dashboard: 'api-overview',
        reason: undefined,
      },
      ...listed.slice(1),
    ]);
    expect(checkInventory(root)).toEqual([]);
  });

  it('requires a reason for "none"', () => {
    inventory([{ ...listed[0], reason: '' }, ...listed.slice(1)]);
    expect(checkInventory(root)).toEqual(['app api: "none" needs a reason']);
  });

  it('names a missing required field', () => {
    const { source: _, ...noSource } = listed[2];
    inventory([...listed.slice(0, 2), noSource, ...listed.slice(3)]);
    expect(checkInventory(root)).toContain(
      'inventory: entries[2] has no "source"',
    );
  });

  it('names an inventory that is not JSON', () => {
    put('infra/observability/inventory.json', '{ not json');
    expect(checkInventory(root)).toEqual([
      'inventory: infra/observability/inventory.json is not valid JSON',
    ]);
  });
});

describe('writeEndpointCount', () => {
  it('rewrites the endpoint count from the OpenAPI operations', () => {
    inventory(listed, 5);
    writeEndpointCount(root);
    const written = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    expect(written.endpoints.count).toBe(2);
    expect(checkInventory(root)).toEqual([]);
  });
});

describe('the CLI', () => {
  const script = join(__dirname, 'observability-inventory.ts');
  const run = (...args: string[]) => {
    try {
      return {
        code: 0,
        out: execFileSync('node', [script, ...args], {
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      };
    } catch (error) {
      const { status, stderr } = error as { status: number; stderr: string };
      return { code: status, out: stderr };
    }
  };

  it('exits 1 and names each problem in another tree', () => {
    put('apps/billing/project.json', '{}');
    expect(run('--root', root)).toEqual({
      code: 1,
      out: expect.stringContaining('missing app billing (apps/billing)'),
    });
  });

  it('passes on this repository with one summary line', () => {
    const result = run('--root', join(__dirname, '..'));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(
      /^observability inventory: \d+ entries, \d+ endpoints, ok\n$/,
    );
  });
});
