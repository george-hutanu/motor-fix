import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

const root = join(__dirname, '..');
const ciText = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const ci = parse(ciText);
const integration = ci.jobs.integration;
const testStep = integration.steps.find(
  (s: { name?: string }) => s.name === 'Integration tests',
);

describe('the integration shards run as a workflow would run them', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shards-'));
    for (const tool of ['npx', 'node']) {
      writeFileSync(
        join(dir, tool),
        `#!/bin/sh\necho "${tool} $*" >> "${dir}/calls.txt"\n[ -n "$FAIL_ON" ] && case "$*" in *"$FAIL_ON"*) exit 7 ;; esac\nexit 0\n`,
      );
      chmodSync(join(dir, tool), 0o755);
    }
    // The step checks each named file and walks up to its project, so the
    // shard runs in a workspace that has them: two Vitest projects.
    for (const [project, spec] of [
      ['libs/domain', 'a.integration.spec.ts'],
      ['apps/api', 'b.integration.spec.ts'],
    ]) {
      mkdirSync(join(dir, 'ws', project, 'src'), { recursive: true });
      writeFileSync(join(dir, 'ws', project, 'project.json'), '{}');
      writeFileSync(join(dir, 'ws', project, 'vitest.config.mts'), '');
      writeFileSync(join(dir, 'ws', project, 'src', spec), '');
    }
  });
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  function runShard(shard: string, specs = '', repeat = '1', failOn = '') {
    const r = spawnSync('bash', ['-e', '-c', testStep.run], {
      cwd: join(dir, 'ws'),
      encoding: 'utf8',
      env: {
        FAIL_ON: failOn,
        NX_SCOPE: 'run-many',
        PATH: `${dir}:${process.env.PATH}`,
        REPEAT: repeat,
        SHARD: shard,
        SPECS: specs,
      },
    });
    let calls: string[] = [];
    try {
      calls = readFileSync(join(dir, 'calls.txt'), 'utf8').trim().split('\n');
    } catch {
      calls = [];
    }
    return { calls, out: r.stdout + r.stderr, status: r.status };
  }

  // @traces 1406-FR-001
  it('runs the exact test slice a domain shard is named after', () => {
    const r = runShard('domain 3/4');

    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      'npx nx run-many -t test --projects=domain --passWithNoTests --output-style=static --shard=3/4',
    ]);
  });

  // @traces 1406-FR-001
  it('runs every project but domain in the other shard with no slice', () => {
    const r = runShard('other projects');

    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      'npx nx run-many -t test --exclude=domain --passWithNoTests --output-style=static',
    ]);
  });

  // @traces 1406-FR-001
  it('fails a domain shard when Nx fails instead of reporting success', () => {
    expect(runShard('domain 1/4', '', '1', '--shard=1/4').status).toBe(7);
    expect(runShard('other projects', '', '1', '--exclude').status).toBe(7);
  });

  // @traces 1406-FR-001
  it('refuses a shard name it does not know and runs nothing', () => {
    for (const name of ['', 'domain', 'domain 1', 'Other projects', 'all']) {
      const r = runShard(name, 'a.integration.spec.ts');
      expect(r.status).toBe(1);
      expect(r.out).toContain("unknown shard '");
      expect(r.calls).toEqual([]);
    }
  });

  // @traces 1406-FR-006
  it('runs each named integration file three times, clearing the audit history before each run', () => {
    const r = runShard(
      'named specs',
      'libs/domain/src/a.integration.spec.ts apps/api/src/b.integration.spec.ts libs/domain/src/c.spec.ts',
      '3',
    );

    expect(r.status).toBe(0);
    const run = [
      'node scripts/clear-activity-log.ts',
      'npx vitest run --config apps/api/vitest.config.mts --no-file-parallelism apps/api/src/b.integration.spec.ts',
      'npx vitest run --config libs/domain/vitest.config.mts --no-file-parallelism libs/domain/src/a.integration.spec.ts',
    ];
    expect(r.calls).toEqual([...run, ...run, ...run]);
  });

  // @traces 1406-FR-006
  it('ends green with nothing run when the named files are all unit specs', () => {
    const r = runShard('named specs', 'libs/domain/src/c.spec.ts', '5');

    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });

  // @traces 1406-FR-006
  it('ends green with nothing run when specs is only whitespace', () => {
    const r = runShard('named specs', '   \n  ', '2');

    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });

  // @traces 1406-FR-006
  it('rejects a repeat below 1 or not a number even when no integration file is named', () => {
    for (const repeat of ['0', '-1', '', 'abc', '1.5', '2; echo x']) {
      const r = runShard('named specs', 'libs/domain/src/c.spec.ts', repeat);
      expect(r.status).toBe(1);
      expect(r.out).toContain('repeat must be 1 or more');
      expect(r.calls).toEqual([]);
    }
  });

  // @traces 1406-FR-006
  it('stops at the first failing repetition of a named file', () => {
    const r = runShard(
      'named specs',
      'libs/domain/src/a.integration.spec.ts',
      '4',
      'vitest',
    );

    expect(r.status).toBe(7);
    expect(r.calls.filter((c) => c.startsWith('npx vitest'))).toHaveLength(1);
  });

  // @traces 1406-FR-006
  it('does not run the named files in a suite shard even when specs is set', () => {
    const r = runShard('domain 2/4', 'libs/domain/src/a.integration.spec.ts');

    expect(r.calls.some((c) => /^npx (jest|vitest) /.test(c))).toBe(false);
  });
});

describe('the integration matrix and its neighbours agree', () => {
  const expr: string = integration.strategy.matrix.shard;
  const lists: string[][] = [...expr.matchAll(/'(\[[^']*\])'/g)].map((m) =>
    JSON.parse(m[1]),
  );

  // @traces 1406-FR-001
  it('has a case branch for every shard the matrix can name', () => {
    const script: string = testStep.run;
    const all = lists.flat();

    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain('named specs');
    expect(script).toContain("'named specs')");
    expect(script).toContain("'other projects')");
    const slices = all.filter((n) => n.startsWith('domain '));
    expect(script).toContain("'domain '*/*)");
    const of = new Set(slices.map((s) => s.split('/')[1]));
    expect(of.size).toBe(1);
  });

  // @traces 1406-FR-004
  it('writes the measured run beside the timeout instead of a provisional figure', () => {
    const lines = ciText.split('\n');
    const at = lines.findIndex(
      (l, i) =>
        i > lines.indexOf('  integration:') && /^ {4}timeout-minutes:/.test(l),
    );
    const above = lines.slice(at - 3, at).join('\n');

    expect(above).not.toMatch(/provisional/i);
    expect(above).toMatch(/\d+ ?(m|min|minutes)/);
  });

  // @traces 1406-FR-003
  it('prints the database report last and whatever the result, on every shard', () => {
    const steps = integration.steps;
    const last = steps[steps.length - 1];

    expect(last.name).toBe('Database waits');
    expect(last.if).toBe('${{ always() }}');
  });

  // @traces 1406-FR-005
  it('is reached by no job other than CI OK, and no caller passes it specs', () => {
    for (const [id, job] of Object.entries<{ needs?: string | string[] }>(
      ci.jobs,
    )) {
      const needs = [job.needs ?? []].flat();
      if (id !== 'ci-ok') expect(needs).not.toContain('integration');
    }
    const release = parse(
      readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'),
    );
    expect(release.jobs.checks.with).toEqual(
      expect.objectContaining({ integration: true }),
    );
    expect(release.jobs.checks.with.specs).toBeUndefined();
  });

  // @traces 1406-FR-001
  it('never lets a pull request build the matrix', () => {
    expect(integration.if).toBe(
      "github.event_name == 'workflow_dispatch' || inputs.integration",
    );
    expect(integration.if).not.toContain('pull_request');
  });

  // @traces 1406-FR-010
  it('says in the header the number of shards the matrix holds', () => {
    const header = ciText.split('\nname: CI')[0] + ciText.slice(0, 1200);
    const words: Record<string, number> = {
      five: 5,
      four: 4,
      six: 6,
      three: 3,
    };
    const said = header.match(/runs in (\w+) shards/)?.[1] ?? '';

    expect(words[said]).toBe(lists[1].length);
  });
});
