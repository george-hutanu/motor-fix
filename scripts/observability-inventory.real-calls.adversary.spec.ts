import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkInventory } from './observability-inventory.ts';

type Entry = Record<string, unknown>;

const NONE = { alerts: 'none', dashboard: 'none', reason: 'added later' };

const listed: Entry[] = [
  { kind: 'app', name: 'api', source: 'apps/api' },
  { kind: 'railway-service', name: 'api', source: 'scripts/railway-deploy.ts' },
].map((entry) => ({ ...entry, ...NONE, story: 'ST-1' }));

const FILE = 'libs/domain/src/calls.ts';

let root: string;

function put(path: string, content: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function scan(source: string | Buffer) {
  put(FILE, source);
  return checkInventory(root);
}

function missing(...hosts: string[]) {
  return hosts.map((host) => `missing outside-service ${host} (${FILE})`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'inventory-real-calls-'));
  put(
    'apps/api/openapi.json',
    JSON.stringify({ paths: { '/a': { get: {}, post: {} } } }),
  );
  put(
    'scripts/railway-deploy.ts',
    "const options = { services: ['api'].map((name) => ({ name })) };\n",
  );
  put(
    'infra/observability/inventory.json',
    JSON.stringify({
      endpoints: { count: 2, source: 'apps/api/openapi.json' },
      entries: listed,
    }),
  );
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('string and comment boundaries', () => {
  it('finds a host after a string ending in an escaped backslash', () => {
    expect(
      scan("const a = '\\\\'; fetch('https://after-slash.eu');\n"),
    ).toEqual(missing('after-slash.eu'));
  });

  it('does not end a string at an escaped quote', () => {
    expect(
      scan("const a = 'it\\'s // https://hid.eu'; fetch('https://real.eu');\n"),
    ).toEqual(missing('real.eu'));
  });

  it('does not end a double-quoted string at an escaped quote', () => {
    expect(
      scan('const a = "say \\"hi\\" /* x"; fetch("https://real.eu");\n'),
    ).toEqual(missing('real.eu'));
  });

  it('keeps a double slash inside a string from starting a comment', () => {
    expect(scan("const a = 'a//b'; fetch('https://real.eu');\n")).toEqual(
      missing('real.eu'),
    );
  });

  it('finds a host in a string that follows a url string on the same line', () => {
    expect(scan("const a = ['https://one.eu', 'https://two.eu'];\n")).toEqual(
      missing('one.eu', 'two.eu'),
    );
  });

  it('ignores an apostrophe inside a line comment', () => {
    expect(scan("// don't\nfetch('https://real.eu');\n")).toEqual(
      missing('real.eu'),
    );
  });

  it('ignores a quote inside a block comment', () => {
    expect(scan("/* it's \"odd */ fetch('https://real.eu');\n")).toEqual(
      missing('real.eu'),
    );
  });

  it('treats a closing comment marker inside a string as text', () => {
    expect(scan("const a = '*/'; fetch('https://real.eu');\n")).toEqual(
      missing('real.eu'),
    );
  });

  it('does not count a host that follows leading whitespace in the string', () => {
    expect(scan("const a = ' https://spaced.eu';\n")).toEqual([]);
  });

  it('does not count a plain http host', () => {
    expect(scan("fetch('http://plain.eu');\n")).toEqual([]);
  });

  it('survives an empty host after the scheme', () => {
    expect(scan('const a = \'https://\';\nconst b = "https:///x";\n')).toEqual(
      [],
    );
  });

  it('ends an unterminated quote at the line and finds the next line host', () => {
    expect(
      scan("const a = 'open // https://hid.eu\nfetch('https://real.eu');\n"),
    ).toEqual(missing('real.eu'));
  });

  it('keeps division operators from starting a comment', () => {
    expect(
      scan(
        "const r = a / b / c;\nfetch('https://real.eu');\n// https://hid.eu\n",
      ),
    ).toEqual(missing('real.eu'));
  });

  it('hides a host in a comment that follows a division', () => {
    expect(scan('const r = a / b; // https://hid.eu\n')).toEqual([]);
  });

  it('does not treat a star after a slash in an expression as a comment start outside text', () => {
    expect(
      scan("const r = 4 /2; fetch('https://real.eu'); // x /* y\n"),
    ).toEqual(missing('real.eu'));
  });

  it('closes a block comment at the first closing marker', () => {
    expect(
      scan(
        "/* https://hid.eu */ fetch('https://real.eu'); /* https://hid2.eu */\n",
      ),
    ).toEqual(missing('real.eu'));
  });

  it('hides everything in a block comment unterminated at end of file', () => {
    expect(scan("fetch('https://real.eu');\n/* https://hid.eu\n")).toEqual(
      missing('real.eu'),
    );
  });

  it('reports nothing for a file that is only an unterminated block comment', () => {
    expect(scan('/*')).toEqual([]);
  });

  it('reports a host beginning a template unterminated at end of file', () => {
    expect(scan('`https://tail.eu')).toEqual(missing('tail.eu'));
  });

  it('reports nothing for an empty file', () => {
    expect(scan('')).toEqual([]);
  });
});

describe('template literals', () => {
  it('finds a host that begins a template spanning several lines', () => {
    expect(scan('const u = `https://tpl.eu/v1\n  more\n  lines`;\n')).toEqual(
      missing('tpl.eu'),
    );
  });

  it('does not count a url on a later line of a template', () => {
    expect(scan('const u = `line one\nhttps://hid.eu/doc\nend`;\n')).toEqual(
      [],
    );
  });

  it('does not treat a comment marker inside a template as a comment', () => {
    expect(
      scan("const u = `a // b /* c`;\nfetch('https://real.eu');\n"),
    ).toEqual(missing('real.eu'));
  });

  it('keeps a block comment inside a template as part of the literal', () => {
    expect(scan('const u = `https://tpl.eu/ /* note */ x`;\n')).toEqual(
      missing('tpl.eu'),
    );
  });

  it('reads a quote inside a template as text on following lines', () => {
    expect(
      scan("const u = `it's\nstill template`;\nfetch('https://real.eu');\n"),
    ).toEqual(missing('real.eu'));
  });

  it('does not look inside an interpolation for a host', () => {
    expect(scan(`const u = \`base \${'https://inner.eu'} end\`;\n`)).toEqual(
      [],
    );
  });

  it('does not end a template at an escaped backtick', () => {
    expect(
      scan("const u = `a \\` // https://hid.eu`;\nfetch('https://real.eu');\n"),
    ).toEqual(missing('real.eu'));
  });
});

describe('line endings and encodings', () => {
  it('ends a line comment at a CRLF line break', () => {
    expect(scan("// https://hid.eu\r\nfetch('https://real.eu');\r\n")).toEqual(
      missing('real.eu'),
    );
  });

  it('ends a lone-quote regex line at a CRLF line break', () => {
    expect(
      scan("const re = /['()*]/g;\r\nfetch('https://real.eu');\r\n"),
    ).toEqual(missing('real.eu'));
  });

  it('finds a host in a CRLF multi-line template', () => {
    expect(scan('const u = `https://tpl.eu\r\nmore`;\r\n')).toEqual(
      missing('tpl.eu'),
    );
  });

  it('finds a host after a Latin-1 byte in a comment', () => {
    const source = Buffer.concat([
      Buffer.from('// caf'),
      Buffer.from([0xe9]),
      Buffer.from("\nfetch('https://real.eu');\n"),
    ]);
    expect(scan(source)).toEqual(missing('real.eu'));
  });

  it('finds a host in a file that begins with a byte order mark', () => {
    expect(scan(`﻿fetch('https://real.eu');\n`)).toEqual(missing('real.eu'));
  });

  it('reports nothing for a UTF-16 file, which is read as UTF-8', () => {
    const source = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("fetch('https://utf16.eu');\n", 'utf16le'),
    ]);
    expect(scan(source)).toEqual([]);
  });

  it('reports nothing for a binary blob under a source name', () => {
    const blob = Buffer.alloc(4096);
    for (let i = 0; i < blob.length; i++) blob[i] = (i * 31) % 256;
    expect(scan(blob)).toEqual([]);
  });

  it('finds a host written with non-ASCII text in the same string line', () => {
    expect(scan("const a = 'ăîșț'; fetch('https://real.eu/ț');\n")).toEqual(
      missing('real.eu'),
    );
  });
});

describe('queues and clients in comments', () => {
  it('does not take a queue from a commented-out exported constant', () => {
    expect(
      scan("// export const OLD = 'old-queue';\nconst q = new Queue(OLD);\n"),
    ).toEqual([]);
  });

  it('does not take a queue from a block-commented constructor', () => {
    expect(scan("/* new Queue('ghost') */\n")).toEqual([]);
  });

  it('does not take a queue from a doc comment example', () => {
    expect(
      scan(
        "/**\n * @example\n * registerQueue('ghost')\n */\nexport const X = 1;\n",
      ),
    ).toEqual([]);
  });

  it('still takes a queue from a real constructor beside a commented one', () => {
    expect(scan("// new Queue('ghost')\nnew Queue('real-q');\n")).toEqual([
      `missing queue real-q (${FILE})`,
    ]);
  });

  it('resolves an exported constant followed by a trailing comment', () => {
    expect(
      scan("export const Q = 'named-q'; // was 'old-q'\nnew Queue(Q);\n"),
    ).toEqual([`missing queue named-q (${FILE})`]);
  });

  it('does not take an SDK client named in a block comment', () => {
    expect(scan('/* new S3Client({}) and import web-push */\n')).toEqual([]);
  });

  it('takes an SDK client that is really constructed', () => {
    expect(scan('const c = new S3Client({});\n')).toEqual([
      `missing outside-service s3 (${FILE})`,
    ]);
  });
});

describe('size and command line', () => {
  it('scans a very long single-line string and a large comment in bounded time', () => {
    const big = `const a = '${'x'.repeat(5_000_000)}';\n/*${' https://hid.eu\n'.repeat(200_000)}*/\nfetch('https://real.eu');\n`;
    const started = Date.now();
    expect(scan(big)).toEqual(missing('real.eu'));
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('scans a file of many short lines in bounded time', () => {
    const lines = "const a = 'it''s';\n".repeat(300_000);
    const started = Date.now();
    expect(scan(`${lines}fetch('https://real.eu');\n`)).toEqual(
      missing('real.eu'),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('exits non-zero from the command line naming only the real host', () => {
    put(FILE, "fetch('https://api.sms.ro'); // see https://docs.sms.ro\n");
    const run = spawnSync(
      'node',
      [join(__dirname, 'observability-inventory.ts'), '--root', root],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(run.status).not.toBe(0);
    const out = `${run.stdout}${run.stderr}`;
    expect(out).toContain(`missing outside-service api.sms.ro (${FILE})`);
    expect(out).not.toContain('docs.sms.ro');
  });

  it('exits zero from the command line when only comments hold links', () => {
    put(FILE, '// see https://docs.sms.ro\n/* https://x.eu */\n');
    const run = spawnSync(
      'node',
      [join(__dirname, 'observability-inventory.ts'), '--root', root],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
  });
});
