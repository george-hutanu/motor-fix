import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const workflow = readFileSync(
  join(root, '.github/workflows/mutation.yml'),
  'utf8',
);

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('triggers', () => {
  it('has exactly the schedule and workflow_dispatch triggers', () => {
    const on = workflow.slice(
      workflow.indexOf('\non:'),
      workflow.indexOf('\npermissions:'),
    );

    expect(on.match(/^ {2}[a-z_]+:/gm)).toEqual([
      '  schedule:',
      '  workflow_dispatch:',
    ]);
    expect(on.match(/- cron:/g)).toHaveLength(1);
    expect(workflow).not.toMatch(
      /pull_request|workflow_run|workflow_call|^ {2}push:/m,
    );
  });

  it('gives the projects and shards inputs an empty default and full a false default', () => {
    expect(workflow).toMatch(/projects:\n(?: {8}.+\n)*? {8}default: ''/);
    expect(workflow).toMatch(/shards:\n(?: {8}.+\n)*? {8}default: ''/);
    expect(workflow).toMatch(/full:\n(?: {8}.+\n)*? {8}default: false/);
  });

  it('asks for read access to contents only', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(workflow).not.toMatch(/write/);
  });
});

describe('the matrix job', () => {
  const mutate = () => job('mutate');

  it('caps concurrency at exactly 5 and lets other jobs finish when one fails', () => {
    expect(mutate().match(/max-parallel: (\d+)/g)).toEqual(['max-parallel: 5']);
    expect(mutate()).toMatch(/fail-fast: false/);
  });

  it('takes its matrix from the plan job and its limit from the entry', () => {
    expect(mutate()).toMatch(
      /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/,
    );
    expect(mutate()).toMatch(/timeout-minutes: \$\{\{ matrix\.timeout \}\}/);
    expect(mutate()).not.toMatch(/timeout-minutes: \d+/);
  });

  it('has its own postgres and redis services, with health checks, on the default ports', () => {
    const services = mutate().slice(
      mutate().indexOf('services:'),
      mutate().indexOf('\n    env:'),
    );

    expect(services).toMatch(
      /postgres:\n(?: {8}.+\n)*? {8}image: postgis\/postgis/,
    );
    expect(services).toMatch(
      /redis:\n(?: {8}.+\n)*? {8}image: valkey\/valkey:9\n/,
    );
    expect(services).toContain('--health-cmd "valkey-cli ping"');
    expect(services.match(/--health-cmd/g)).toHaveLength(2);
    expect(services).toMatch(/'5432:5432'/);
    expect(services).toMatch(/'6379:6379'/);
  });

  it('points the database and cache URLs at the job-local services', () => {
    expect(mutate()).toMatch(
      /DATABASE_URL: postgresql:\/\/[^@\n]+@localhost:5432\//,
    );
    expect(mutate()).toMatch(/REDIS_URL: redis:\/\/localhost:6379/);
  });

  it('migrates the database after installing and before mutating', () => {
    const body = mutate();

    expect(body.indexOf('npm ci')).toBeGreaterThan(-1);
    expect(body.indexOf('prisma migrate deploy')).toBeGreaterThan(
      body.indexOf('npm ci'),
    );
    expect(body.indexOf('prisma migrate deploy')).toBeLessThan(
      body.indexOf('test:mutation'),
    );
  });

  it('keys the cache by job id and restores it only when full is not set', () => {
    const body = mutate();

    expect(body).toMatch(
      /restore@v\d+\n\s+with:\n(?:\s+.+\n)*?\s+key: mutation\/\$\{\{ matrix\.id \}\}\//,
    );
    expect(body).toMatch(
      /- name: Restore[^\n]*\n\s+if: \$\{\{ !inputs\.full \}\}/,
    );
    expect(body).toMatch(
      /INCREMENTAL: \$\{\{ inputs\.full && 'false' \|\| 'true' \}\}/,
    );
  });

  it('ends each cache restore key with a slash so one job id never restores another whose id extends it', () => {
    const keys = [
      ...mutate().matchAll(
        /^\s+(?:key: )?(mutation\/\$\{\{ matrix\.id \}\}[^\n]*)$/gm,
      ),
    ].map((m) => m[1]);

    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys)
      expect(key).toMatch(/\/(\$\{\{ github\.run_id \}\})?$/);
  });

  it('saves the cache and uploads the report even when the mutation step failed, under the job id', () => {
    const body = mutate();

    expect(body).toMatch(
      /if: always\(\) && steps\.mutation\.outcome != 'skipped'\n\s+uses: actions\/cache\/save/,
    );
    expect(body).toMatch(
      /upload-artifact@v\d+\n\s+with:\n\s+name: mutation-\$\{\{ matrix\.id \}\}/,
    );
  });

  it('passes the shard flag only for a sharded entry', () => {
    expect(mutate()).toMatch(/\$\{SHARD:\+--shard=\$SHARD\}/);
  });

  it('never puts an expression inside a run script', () => {
    const runs = workflow.split('\n').filter((l) => /^\s+(- )?run: /.test(l));

    expect(runs.length).toBeGreaterThan(3);
    expect(runs.filter((l) => l.includes('${{'))).toEqual([]);
  });

  it('does not pull the user-supplied inputs anywhere but the plan job environment', () => {
    const outside = workflow.replace(job('plan'), '');

    expect(outside.match(/inputs\.(projects|shards)/g)).toBeNull();
  });
});

describe('the plan and summary jobs', () => {
  it('bounds both jobs with a timeout', () => {
    expect(job('plan')).toMatch(/timeout-minutes: \d+/);
    expect(job('summary')).toMatch(/timeout-minutes: \d+/);
  });

  it('runs the summary after the plan and the matrix, always', () => {
    expect(job('summary')).toMatch(/needs: \[plan, mutate\]/);
    expect(job('summary')).toMatch(/if: always\(\)/);
  });

  it('hands the summary the matrix and the matrix result', () => {
    expect(job('summary')).toMatch(
      /MATRIX: \$\{\{ needs\.plan\.outputs\.matrix \}\}/,
    );
    expect(job('summary')).toMatch(/RESULT: \$\{\{ needs\.mutate\.result \}\}/);
  });

  it('downloads every job report as its own directory, not merged', () => {
    const body = job('summary');

    expect(body).toMatch(/pattern: mutation-\*/);
    expect(body).not.toMatch(/merge-multiple: true/);
  });

  it('reads the directory it downloads to', () => {
    const body = job('summary');
    const path = /path: (\S+)/.exec(body)?.[1];

    expect(body).toContain(`node scripts/mutation-summary.ts ${path}`);
  });
});

describe('the docs', () => {
  const docs = {
    agents: readFileSync(join(root, 'AGENTS.md'), 'utf8'),
    runner: readFileSync(
      join(root, '.claude/agents/mutation-runner.md'),
      'utf8',
    ),
    skill: readFileSync(
      join(root, '.claude/skills/speckit-harden/SKILL.md'),
      'utf8',
    ),
  };

  it.each(Object.keys(docs))(
    '%s says the Mutation workflow runs every 3 days and on demand',
    (name) => {
      expect(docs[name as keyof typeof docs]).toMatch(
        /every 3 days|every third day/i,
      );
    },
  );

  it.each(Object.keys(docs))(
    '%s says mutation is sharded and never runs locally',
    (name) => {
      const text = docs[name as keyof typeof docs];

      expect(text).toMatch(/shard/i);
      expect(text).toMatch(/never (on a laptop|on this machine|here|locally)/i);
    },
  );

  it.each(Object.keys(docs))(
    '%s never tells the reader to run mutation by hand on the machine',
    (name) => {
      expect(docs[name as keyof typeof docs]).not.toMatch(
        /(npx )?nx (run|affected)[^\n]*test:mutation/,
      );
      expect(docs[name as keyof typeof docs]).not.toMatch(
        /test:mutation:affected -- /,
      );
    },
  );
});
