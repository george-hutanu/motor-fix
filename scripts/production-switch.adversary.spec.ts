import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { block, read, script } from './workflow-text.ts';

// The two workflows that read the production switch, read as text and judged
// the way GitHub's expression language would judge them: the conditions are
// evaluated for hostile values of the variable instead of compared as strings.
const root = join(__dirname, '..');
const release = read('release.yml');
const backup = read('backup.yml');

type Value = string | number | boolean | null | Value[];
type Context = Record<string, string | undefined>;

const truthy = (v: Value) => v !== null && v !== false && v !== '' && v !== 0;

// Equality of two strings ignores letter case, as GitHub's `==` does; a missing
// context value reads as null, which compares as the empty string.
function same(a: Value, b: Value) {
  const text = (v: Value) => {
    if (v === null) return '';
    if (typeof v === 'string') return v.toLowerCase();
    throw new Error(`cannot compare ${JSON.stringify(v)}`);
  };
  return text(a) === text(b);
}

const functions: Record<string, (args: Value[]) => Value> = {
  always: () => true,
  cancelled: () => false,
  failure: () => false,
  fromJSON: ([text]) => JSON.parse(String(text)) as Value,
  success: () => true,
};

const words: Record<string, Value> = { false: false, null: null, true: true };

function tokenize(text: string) {
  const token = /\s*('(?:[^']|'')*'|==|!=|&&|\|\||[()!,]|[A-Za-z_][\w.-]*)/y;
  const tokens: string[] = [];
  let consumed = 0;
  for (let found = token.exec(text); found; found = token.exec(text)) {
    tokens.push(found[1] ?? '');
    consumed = token.lastIndex;
  }
  if (text.slice(consumed).trim() !== '') {
    throw new Error(`cannot read the expression: ${text}`);
  }
  return tokens;
}

class Reader {
  readonly calls: string[] = [];
  readonly reads: string[] = [];
  private at = 0;

  private readonly tokens: string[];
  private readonly context: Context;

  constructor(tokens: string[], context: Context) {
    this.tokens = tokens;
    this.context = context;
  }

  done() {
    return this.at === this.tokens.length;
  }

  or(): Value {
    let left = this.and();
    while (this.accept('||')) {
      const right = this.and();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  private and(): Value {
    let left = this.equality();
    while (this.accept('&&')) {
      const right = this.equality();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private equality(): Value {
    let left = this.primary();
    for (let op = this.accept('==', '!='); op; op = this.accept('==', '!=')) {
      left = same(left, this.primary()) !== (op === '!=');
    }
    return left;
  }

  private primary(): Value {
    const next = this.next();
    if (next.startsWith("'")) return next.slice(1, -1).replaceAll("''", "'");
    if (next === '(') return this.group();
    if (next === '!') return !truthy(this.primary());
    if (this.accept('(')) return this.call(next);
    if (Object.hasOwn(words, next)) return words[next] ?? null;
    this.reads.push(next);
    return this.context[next] ?? null;
  }

  private group() {
    const inner = this.or();
    this.accept(')');
    return inner;
  }

  private call(name: string) {
    const args: Value[] = [];
    while (!this.accept(')')) {
      args.push(this.or());
      this.accept(',');
    }
    const run = Object.hasOwn(functions, name) ? functions[name] : undefined;
    if (!run) throw new Error(`unsupported function ${name}`);
    this.calls.push(name);
    return run(args);
  }

  private next() {
    const token = this.tokens[this.at++];
    if (token === undefined) throw new Error('the expression ends early');
    return token;
  }

  private accept(...operators: string[]) {
    const token = this.tokens[this.at];
    if (token === undefined || !operators.includes(token)) return undefined;
    this.at++;
    return token;
  }
}

// The subset of GitHub's expression language the two workflows use. It throws
// on anything else, so a rewrite into a function this reader does not know
// fails the test instead of passing it.
function evaluate(source: string, context: Context) {
  const text = source
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '');
  const reader = new Reader(tokenize(text), context);
  const value = reader.or();
  if (!reader.done()) throw new Error(`trailing tokens in: ${text}`);
  return { calls: reader.calls, reads: reader.reads, value };
}

const holds = (condition: string, context: Context) =>
  truthy(evaluate(condition, context).value);

// Every spelling of the variable's value that someone could plausibly set.
const values: (string | undefined)[] = [
  undefined,
  '',
  'true',
  'TRUE',
  'True',
  'tRuE',
  'false',
  'FALSE',
  '1',
  '0',
  'yes',
  'on',
  'enabled',
  ' true',
  'true ',
  'true\n',
  'truee',
  'tru',
  'null',
  "'true'",
  '"true"',
  'ｔｒｕｅ',
];
const isOn = (value: string | undefined) => value?.toLowerCase() === 'true';
const label = (value: string | undefined) =>
  value === undefined ? 'unset' : JSON.stringify(value);
const cases = values.map((value) => [label(value), value] as const);

function jobIds(text: string) {
  const lines = text.split('\n');
  return lines
    .slice(lines.indexOf('jobs:') + 1)
    .filter((line) => /^ {2}[\w-]+:$/.test(line))
    .map((line) => line.trim().slice(0, -1));
}

function jobOf(text: string, id: string) {
  return block(text, id, 2);
}

interface Step {
  condition: string | undefined;
  name: string;
  text: string;
}

function stepsOf(text: string, id: string): Step[] {
  const steps = block(jobOf(text, id), 'steps', 4);
  return steps
    .split('\n')
    .slice(1)
    .join('\n')
    .split(/\n(?= {6}- )/)
    .map((text) => ({
      condition: text.match(/^ {8}if: (.+)$/m)?.[1]?.trim(),
      name:
        text.match(/^ {6}- name: (.+)$/m)?.[1]?.trim() ??
        text.match(/^ {6}- uses: (.+)$/m)?.[1]?.trim() ??
        '',
      text,
    }));
}

const startedBy = (steps: Step[], context: Context) =>
  steps
    .filter((step) => !step.condition || holds(step.condition, context))
    .map((step) => step.name);

const step = (steps: Step[], name: string) => {
  const found = steps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no step ${name}`);
  return found;
};

// What the runner does with a `run: |` step: bash, errexit, nounset, pipefail.
function runStep(text: string, env: Record<string, string>) {
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-euo', 'pipefail', '-c', script(text)],
    { encoding: 'utf8', env: { PATH: process.env['PATH'], ...env } },
  );
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'production-switch-'));
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('the expression reader these tests rest on', () => {
  it('compares strings without regard to letter case and reads a missing value as empty', () => {
    expect(holds("vars.X == 'true'", { 'vars.X': 'TRUE' })).toBe(true);
    expect(holds("vars.X == 'true'", { 'vars.X': 'true ' })).toBe(false);
    expect(holds("vars.X == 'true'", {})).toBe(false);
    expect(holds("vars.X != 'true'", {})).toBe(true);
    expect(holds("vars.X == ''", {})).toBe(true);
  });

  it('answers a && b || c with the operand GitHub picks', () => {
    const pick = (x: string | undefined) =>
      evaluate("vars.X == 'true' && 'on' || 'off'", { 'vars.X': x }).value;
    expect(pick('true')).toBe('on');
    expect(pick('no')).toBe('off');
  });

  it('refuses a function it does not know', () => {
    expect(() => evaluate("contains(vars.X, 'true')", {})).toThrow(
      'unsupported function contains',
    );
  });
});

// @traces 1348-FR-001
describe('the release workflow’s production switch', () => {
  const production = jobOf(release, 'production');
  const condition = production.match(/^ {4}if: (.+)$/m)?.[1] ?? '';
  const staging = stepsOf(release, 'staging');
  const note = step(staging, 'Note that production is off');

  it.each(cases)(
    'runs the production job only for the value %s the variable lets through',
    (_label, value) => {
      expect(holds(condition, { 'vars.PRODUCTION_ENABLED': value })).toBe(
        isOn(value),
      );
    },
  );

  it.each(cases)(
    'says production is off in exactly the runs where the production job is skipped, for %s',
    (_label, value) => {
      const context = { 'vars.PRODUCTION_ENABLED': value };
      const noted = startedBy(staging, context).includes(note.name);

      expect(noted).toBe(!holds(condition, context));
    },
  );

  it('reads the repository variable and nothing else to decide', () => {
    expect(evaluate(condition, {}).reads).toEqual(['vars.PRODUCTION_ENABLED']);
    expect(evaluate(note.condition ?? '', {}).reads).toEqual([
      'vars.PRODUCTION_ENABLED',
    ]);
  });

  it('lets a failed or cancelled staging end the run red instead of printing that it ended after staging', () => {
    expect(evaluate(note.condition ?? '', {}).calls).toEqual([]);
    expect(evaluate(condition, {}).calls).toEqual([]);
    expect(release).not.toMatch(/continue-on-error/);
  });

  it('binds the production environment in the production job alone, before which nothing waits on a reviewer', () => {
    const bound = [...release.matchAll(/^ {4}environment: (.+)$/gm)].map(
      (m) => m[1],
    );

    expect(bound).toEqual(['staging', 'production']);
    expect(production).toMatch(/^ {4}environment: production$/m);
    expect(release.match(/release-production/g)).toHaveLength(1);
    expect(production).toContain('group: release-production');
    expect(release).not.toMatch(/^concurrency:/m);
  });

  it('deploys to production from the production job alone and nothing needs it', () => {
    const jobs = jobIds(release);

    expect(jobs).toEqual(['checks', 'images', 'staging', 'production']);
    expect(release.match(/railway-deploy\.ts production/g)).toHaveLength(1);
    expect(production).toContain('railway-deploy.ts production');
    for (const id of jobs.filter((job) => job !== 'production')) {
      expect(jobOf(release, id)).not.toMatch(/needs:.*production/);
    }
  });

  it('ends the staging job with the note and with nothing after it', () => {
    expect(staging.at(-1)?.name).toBe('Note that production is off');
    expect(startedBy(staging, { 'vars.PRODUCTION_ENABLED': 'true' })).toEqual(
      staging.slice(0, -1).map((s) => s.name),
    );
  });

  it('writes one well-formed notice and one summary line under the runner’s strict shell', () => {
    const summary = join(dir, 'summary.md');
    const run = runStep(note.text, { GITHUB_STEP_SUMMARY: summary });

    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^::notice(?: \w+=[^:,]+(?:,\w+=[^:,]+)*)?::[^\n]*PRODUCTION_ENABLED[^\n]*$/,
    );
    const written = readFileSync(summary, 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(written.trimEnd().split('\n')).toHaveLength(1);
    expect(written).toContain('PRODUCTION_ENABLED');
    expect(written).toMatch(/\btrue\b/);
  });

  it('appends to a summary the earlier steps wrote instead of replacing it', () => {
    const summary = join(dir, 'summary.md');
    writeFileSync(summary, '### Staging\nfour services healthy\n');

    const run = runStep(note.text, { GITHUB_STEP_SUMMARY: summary });
    const lines = readFileSync(summary, 'utf8').trimEnd().split('\n');

    expect(run.status).toBe(0);
    expect(lines.slice(0, 2)).toEqual(['### Staging', 'four services healthy']);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('PRODUCTION_ENABLED');
  });

  it('writes the summary to a path with spaces and a dollar sign', () => {
    const folder = join(dir, 'a b $HOME');
    mkdirSync(folder);
    const summary = join(folder, 'step summary.md');

    const run = runStep(note.text, { GITHUB_STEP_SUMMARY: summary });

    expect(run.status).toBe(0);
    expect(readFileSync(summary, 'utf8')).toContain('PRODUCTION_ENABLED');
  });
});

// @traces 1348-FR-003
describe('the backup workflow’s production switch', () => {
  const matrix =
    block(backup, 'strategy', 4).match(/\$\{\{.*fromJSON.*\}\}/)?.[0] ?? '';
  const steps = stepsOf(backup, 'backup');
  const offNote = step(steps, 'Note that production is off');

  const legs = (value: string | undefined) =>
    evaluate(matrix, { 'vars.PRODUCTION_ENABLED': value }).value;

  it.each(cases)(
    'puts staging in the matrix, and production only when the variable is true, for %s',
    (_label, value) => {
      const list = legs(value) as string[];

      expect(Array.isArray(list)).toBe(true);
      expect([...list].sort()).toEqual(
        isOn(value) ? ['production', 'staging'] : ['staging'],
      );
    },
  );

  it('decides the matrix from the repository variable and nothing else', () => {
    expect(evaluate(matrix, {}).reads).toEqual(['vars.PRODUCTION_ENABLED']);
  });

  it('is one job, with no condition of its own that reads the matrix and no environment but the matrix’s', () => {
    const job = jobOf(backup, 'backup');

    expect(jobIds(backup)).toEqual(['backup']);
    expect(job).not.toMatch(/^ {4}if:/m);
    expect(job.match(/^ {4}environment: (.+)$/m)?.[1]).toBe(
      '$' + '{{ matrix.environment }}',
    );
    expect(backup).not.toMatch(/environment: *production/);
    expect(backup).not.toMatch(/^concurrency:/m);
  });

  it.each(cases)(
    'notes the skip on the staging leg only, whatever staging’s own settings are, for %s',
    (_label, value) => {
      for (const skip of [undefined, 'false', 'true']) {
        const staging = startedBy(steps, {
          'matrix.environment': 'staging',
          'steps.settings.outputs.skip': skip,
          'vars.PRODUCTION_ENABLED': value,
        });
        const production = startedBy(steps, {
          'matrix.environment': 'production',
          'steps.settings.outputs.skip': skip,
          'vars.PRODUCTION_ENABLED': value,
        });

        expect(staging.includes(offNote.name)).toBe(!isOn(value));
        expect(production).not.toContain(offNote.name);
      }
    },
  );

  it.each([
    ['staging', 'true'],
    ['staging', undefined],
    ['production', 'true'],
  ] as const)(
    'on the %s leg with production %s, an unset postgres service starts no work and a set one starts the copy',
    (environment, enabled) => {
      const context = (skip: string | undefined) => ({
        'matrix.environment': environment,
        'steps.settings.outputs.skip': skip,
        'vars.PRODUCTION_ENABLED': enabled,
      });
      const work = (names: string[]) =>
        names.filter((name) => /Dump|Railway|SSH key/.test(name));
      const copy = step(steps, 'Dump, encrypt, upload and prune').name;

      expect(work(startedBy(steps, context('true')))).toEqual([]);
      expect(startedBy(steps, context('true'))).toContain('Note the skip');
      expect(startedBy(steps, context(undefined))).toContain(copy);
      expect(startedBy(steps, context(undefined))).not.toContain(
        'Note the skip',
      );
    },
  );

  it('writes one well-formed notice and one summary line under the runner’s strict shell', () => {
    const summary = join(dir, 'summary.md');
    const run = runStep(offNote.text, { GITHUB_STEP_SUMMARY: summary });

    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^::notice(?: \w+=[^:,]+(?:,\w+=[^:,]+)*)?::[^\n]*PRODUCTION_ENABLED[^\n]*$/,
    );
    const written = readFileSync(summary, 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(written.trimEnd().split('\n')).toHaveLength(1);
    expect(written).toMatch(/\btrue\b/);
  });

  it('appends to a summary the earlier steps wrote and survives a path with spaces', () => {
    const folder = join(dir, 'a b $HOME');
    mkdirSync(folder);
    const summary = join(folder, 'step summary.md');
    writeFileSync(summary, 'earlier line\n');

    const run = runStep(offNote.text, { GITHUB_STEP_SUMMARY: summary });
    const lines = readFileSync(summary, 'utf8').trimEnd().split('\n');

    expect(run.status).toBe(0);
    expect(lines[0]).toBe('earlier line');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('PRODUCTION_ENABLED');
  });
});

// @traces 1348-FR-004
describe('who reads and who sets the switch', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const code = tracked.filter(
    (file) =>
      !/\.(md|mdx)$/.test(file) &&
      !/\.(spec|test)\.[cm]?[jt]sx?$/.test(file) &&
      !/^(specs|\.specify|docs|\.work)\//.test(file),
  );

  it('is named by the release and the backup workflow and by no other tracked file that is not a document or a test', () => {
    const naming = code.filter((file) => {
      try {
        return readFileSync(join(root, file), 'utf8').includes(
          'PRODUCTION_ENABLED',
        );
      } catch {
        return false;
      }
    });

    expect(naming.sort()).toEqual([
      '.github/workflows/backup.yml',
      '.github/workflows/release.yml',
    ]);
  });

  it.each([
    ['release.yml', release],
    ['backup.yml', backup],
  ])(
    '%s only reads the variable as vars and never writes or defaults it',
    (_name, text) => {
      const lines = text
        .split('\n')
        .filter((line) => line.includes('PRODUCTION_ENABLED'));

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const body = line.trim();
        const prose = body.startsWith('#') || body.startsWith('echo ');
        expect(
          prose || /(^|[^.\w])vars\.PRODUCTION_ENABLED \S+ '/.test(body),
        ).toBe(true);
      }
      expect(text).not.toMatch(/gh +(variable|api|secret)/);
      expect(text).not.toMatch(
        /(secrets|env|inputs|github)\.PRODUCTION_ENABLED/,
      );
      expect(text).not.toMatch(/^ *PRODUCTION_ENABLED:/m);
    },
  );

  it('leaves every other workflow without a binding to the production environment', () => {
    const others = readdirSync(join(root, '.github', 'workflows')).filter(
      (file) =>
        /\.ya?ml$/.test(file) && !['release.yml', 'backup.yml'].includes(file),
    );

    expect(others.length).toBeGreaterThan(0);
    for (const file of others) {
      expect(read(file)).not.toMatch(/environment:.*production/);
    }
  });
});
