// @traces 1159-FR-006 1159-FR-007 1159-FR-018 1159-FR-010 1159-FR-011 1159-FR-014 1159-FR-019
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Mutation workflow, read as text: no YAML parser is a dependency.
const workflow = readFileSync(
  join(__dirname, '..', '.github/workflows/mutation.yml'),
  'utf8',
);

/** The lines of one top-level job, up to the next job. */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('mutation workflow triggers', () => {
  // @traces 1344-FR-008
  it('runs every 3 days at 02:00 and on demand, never on a pull request', () => {
    expect(workflow).toMatch(/^ {4}- cron: '0 2 \*\/3 \* \*'$/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(workflow).not.toMatch(/pull_request/);
    expect(workflow).not.toMatch(/^ {2}push:$/m);
  });

  it('takes the projects, shards and full inputs', () => {
    expect(workflow).toMatch(/^ {6}projects:$/m);
    expect(workflow).toMatch(/^ {6}shards:$/m);
    expect(workflow).toMatch(/^ {6}full:\n(?: {8}.+\n)*? {8}type: boolean$/m);
  });
});

describe('the plan job', () => {
  it('hands the inputs to the planner and outputs its matrix', () => {
    const plan = job('plan');

    expect(plan).toMatch(/PROJECTS: \$\{\{ inputs\.projects \}\}/);
    expect(plan).toMatch(/SHARDS: \$\{\{ inputs\.shards \}\}/);
    expect(plan).toMatch(/run: node scripts\/mutation-plan\.ts$/m);
    expect(plan).toMatch(/matrix: \$\{\{ steps\.plan\.outputs\.matrix \}\}/);
  });
});

describe('the mutate job', () => {
  const mutate = job('mutate');

  it('runs the planned matrix, 5 at a time, without stopping the rest on a failure', () => {
    expect(mutate).toMatch(
      /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/,
    );
    expect(mutate).toMatch(/^ {6}max-parallel: 5$/m);
    expect(mutate).toMatch(/^ {6}fail-fast: false$/m);
  });

  it('takes each entry its own time limit and names the job by it', () => {
    expect(mutate).toMatch(
      /^ {4}timeout-minutes: \$\{\{ matrix\.timeout \}\}$/m,
    );
    expect(mutate).toMatch(/^ {4}name: mutate \$\{\{ matrix\.id \}\}$/m);
  });

  // @traces 1175-FR-001
  it('gives each job its own PostgreSQL and Redis and migrates before mutating', () => {
    expect(mutate).toMatch(/^ {6}postgres:\n {8}image: postgis\/postgis/m);
    expect(mutate).toMatch(/^ {6}redis:\n {8}image: valkey\/valkey:9$/m);
    const migrate = mutate.indexOf('prisma migrate deploy');
    expect(migrate).toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(mutate.indexOf(':test:mutation'));
  });

  // The data-store metrics specs read pg_stat_statements, which a service
  // container cannot preload by command: without it domain's rest shard
  // fails its initial test run (run 38127622063).
  it('preloads pg_stat_statements before migrating, as CI does', () => {
    const preload = mutate.indexOf(
      "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'",
    );
    expect(preload).toBeGreaterThan(-1);
    expect(mutate).toMatch(
      /docker restart \$\{\{ job\.services\.postgres\.id \}\}/,
    );
    expect(preload).toBeLessThan(mutate.indexOf('prisma migrate deploy'));
  });

  // Streamed, so a job cancelled at its limit still shows how far Stryker
  // got: static output printed nothing before the cancel (run 38127622063).
  // npx applies .npmrc's --experimental-vm-modules, without which Jest
  // cannot load the ESM-only Angular and Nest packages (run 38126969341).
  it('runs one project or shard through npx, incrementally unless full is set', () => {
    expect(mutate).toMatch(
      /run: npx nx run "\$PROJECT:test:mutation" --output-style=stream -- --incremental=\$INCREMENTAL \$\{SHARD:\+--shard=\$SHARD\}$/m,
    );
    expect(mutate).toMatch(
      /INCREMENTAL: \$\{\{ inputs\.full && 'false' \|\| 'true' \}\}$/m,
    );
    expect(mutate).toMatch(
      /- name: Restore the mutation results of earlier runs\n {8}if: \$\{\{ !inputs\.full \}\}$/m,
    );
  });

  // A key that ended in the id alone would let mcp restore mcp-tools' file.
  it('keeps a cache and an artifact per entry', () => {
    const keys = [...mutate.matchAll(/key: (.+)$/gm)].map((m) => m[1]);
    expect(keys).toHaveLength(2);
    for (const key of keys)
      expect(key).toMatch(
        /^mutation\/\$\{\{ matrix\.id \}\}\/\$\{\{ github\.ref_name \}\}\/\$\{\{ github\.run_id \}\}$/,
      );

    expect(mutate).toMatch(/^ {12}mutation\/\$\{\{ matrix\.id \}\}\/$/m);
    expect(mutate).toMatch(/name: mutation-\$\{\{ matrix\.id \}\}$/m);
  });
});

describe('the summary job', () => {
  const summary = job('summary');

  it('runs after every job, even when some failed, and reads each one result', () => {
    expect(summary).toMatch(/^ {4}needs: \[plan, mutate\]$/m);
    expect(summary).toMatch(/^ {4}if: always\(\)$/m);
    expect(summary).toMatch(/pattern: mutation-\*$/m);
    expect(summary).toMatch(/MATRIX: \$\{\{ needs\.plan\.outputs\.matrix \}\}/);
    expect(summary).toMatch(/RESULT: \$\{\{ needs\.mutate\.result \}\}/);
    expect(summary).toMatch(/run: node scripts\/mutation-summary\.ts /);
  });
});

describe('the docs that describe a mutation run', () => {
  const doc = (path: string) =>
    readFileSync(join(__dirname, '..', path), 'utf8');

  it('says AGENTS.md runs mutation every 3 days, sharded, never on a laptop', () => {
    const agents = doc('AGENTS.md');

    expect(agents).toMatch(/mutation\.yml` runs it every 3 days/);
    expect(agents).toMatch(/scripts\/mutation-shards\.json/);
    expect(agents).not.toMatch(/nightly/);
  });

  it.each([
    '.claude/skills/speckit-harden/SKILL.md',
    '.claude/agents/mutation-runner.md',
    '.specify/contexts/harden.md',
  ])(
    '%s sends mutation to the workflow and runs no Stryker locally',
    (path) => {
      const text = doc(path);

      expect(text).toMatch(/mutation\.yml|Mutation workflow/);
      expect(text).not.toMatch(/nx run <project>:test:mutation/);
      expect(text).not.toMatch(/npx nx run[^`]*test:mutation/);
    },
  );

  // @traces 1344-FR-001 1344-FR-003 1344-FR-005
  it('leaves mutation out of harden: only the mutation-runner, asked for by name, dispatches a run', () => {
    for (const path of [
      '.claude/skills/speckit-harden/SKILL.md',
      '.specify/contexts/harden.md',
    ]) {
      const text = doc(path);

      expect(text).not.toMatch(/gh workflow run mutation\.yml/);
      expect(text).not.toMatch(/launch[^\n]*`?mutation-runner/i);
      expect(text).not.toMatch(/mutation score/i);
    }
    expect(doc('.claude/agents/mutation-runner.md')).toMatch(
      /gh workflow run mutation\.yml/,
    );
  });

  // @traces 1344-FR-004
  it('keeps the mutation-runner for a review asked for by name, and the adversary before no mutation run', () => {
    expect(doc('.claude/agents/mutation-runner.md')).toMatch(
      /^description: .*only by an explicit mutation review.*no lifecycle command calls it/m,
    );
    expect(doc('.claude/agents/test-adversary.md')).not.toMatch(
      /before the mutation run/,
    );
  });

  // @traces 1344-FR-006
  it('says in AGENTS.md that mutation is never part of a task and runs only on its schedule and by hand', () => {
    const agents = doc('AGENTS.md').replace(/\s+/g, ' ');

    expect(agents).toMatch(/Mutation is never part of a task's lifecycle/);
    expect(agents).toMatch(
      /schedule on `main` and `workflow_dispatch` are the only places it runs/,
    );
    expect(agents).toMatch(/surviving mutant is picked from the Project/);
  });
});
