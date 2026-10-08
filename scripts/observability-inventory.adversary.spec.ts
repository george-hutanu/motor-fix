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
  root = mkdtempSync(join(tmpdir(), 'observability-adversary-'));
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
  inventory(listed);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('checkInventory under hostile input', () => {
  it('ignores hosts under the .test, .invalid and .localhost placeholder TLDs', () => {
    put(
      'libs/domain/src/links.ts',
      [
        "const a = 'https://shop.test/x';",
        "const b = 'https://nowhere.invalid/x';",
        "const c = 'https://app.localhost/x';",
      ].join('\n'),
    );
    expect(checkInventory(root)).toEqual([]);
  });

  it('does not scan testing helpers, stubs, test stores, generated code or scripts', () => {
    put('libs/domain/src/a.testing.ts', "new Queue('from-testing');\n");
    put('libs/domain/src/mail-stub.ts', "fetch('https://stub.only.eu');\n");
    put('libs/domain/src/test-store.ts', "registerQueue('from-store');\n");
    put(
      'libs/domain/src/generated/client.ts',
      "fetch('https://gen.only.eu');\n",
    );
    put('scripts/graphql.ts', "fetch('https://backboard.only.eu');\n");
    expect(checkInventory(root)).toEqual([]);
  });

  it('skips a Queue built from an identifier that is not an exported string constant', () => {
    put(
      'apps/worker/src/jobs.ts',
      "const local = 'hidden';\nconst q = new Queue(local);\nconst r = new Queue(config.name);\n",
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
    expect(checkInventory(root)).toEqual([]);
  });

  it('rejects alerts given as an empty array', () => {
    inventory([{ ...listed[0], alerts: [] }, listed[1]]);
    expect(checkInventory(root)).toEqual([
      'app api: alerts must be "none" or a list of rule uids',
    ]);
  });

  it('rejects two entries of the same kind with the same name', () => {
    inventory([...listed, { ...listed[0], source: 'apps/api' }]);
    expect(checkInventory(root)).toEqual([
      'inventory: app api is listed twice',
    ]);
  });
});

describe('writeEndpointCount', () => {
  it('changes only the count and leaves every entry as it was', () => {
    inventory(listed, 99);
    const path = join(root, 'infra/observability/inventory.json');
    const before = JSON.parse(readFileSync(path, 'utf8'));
    writeEndpointCount(root);
    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after).toEqual({
      endpoints: { count: 2, source: 'apps/api/openapi.json' },
      entries: before.entries,
    });
  });
});
