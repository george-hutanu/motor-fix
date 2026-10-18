// @traces 1174-FR-007 1174-FR-008 1174-FR-013
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read as text, like backup-workflows.spec.ts: the drill runs only on GitHub.
const root = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');
const workflow = read('.github', 'workflows', 'pitr-drill.yml');
const script = read('scripts', 'backup', 'pitr-drill.sh');

const lines = workflow.split('\n');
function job(name: string): string {
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`pitr-drill.yml has no job ${name}`);
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

const steps = (block: string) =>
  block
    .slice(block.indexOf('    steps:'))
    .split(/\n(?= {6}- )/)
    .slice(1);

describe('the point-in-time drill workflow', () => {
  it('runs by hand and an hour after the dump drill each quarter', () => {
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
    expect(workflow).toMatch(/cron: '0 5 1 1,4,7,10 \*'/);
    expect(read('.github', 'workflows', 'restore-drill.yml')).toMatch(
      /cron: '0 4 1 1,4,7,10 \*'/,
    );
  });

  it('runs the self-contained drill on a pull request that changes the drill or the image', () => {
    const on = workflow.slice(
      workflow.indexOf('on:'),
      workflow.indexOf('\npermissions:'),
    );
    const paths = on
      .slice(on.indexOf('  pull_request:'))
      .split('\n')
      .filter((line) => /^ {6}- /.test(line))
      .map((line) => line.trim().slice(2).replace(/^'|'$/g, ''));

    expect(paths).toEqual([
      'infra/postgres/**',
      'scripts/backup/pitr-drill.sh',
      '.github/workflows/pitr-drill.yml',
    ]);
    expect(job('staging')).toMatch(
      /^ {4}if: github\.event_name != 'pull_request'$/m,
    );
    expect(job('self-contained')).not.toMatch(/^ {4}if:/m);
  });

  it('reads the repository and nothing more', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(workflow).not.toContain('packages: write');
  });

  it('has the self-contained and the staging job, each bounded in time', () => {
    const ids = lines
      .slice(lines.indexOf('jobs:') + 1)
      .filter((line) => /^ {2}[\w-]+:$/.test(line))
      .map((line) => line.trim().slice(0, -1));

    expect(ids).toEqual(['self-contained', 'staging']);
    for (const id of ids) expect(job(id)).toMatch(/timeout-minutes: \d+/);
  });

  it('runs the self-contained drill with no environment and no secret', () => {
    const block = job('self-contained');

    expect(block).not.toMatch(/environment:/);
    expect(block).not.toContain('secrets.');
    expect(block).toContain(
      'bash scripts/backup/pitr-drill.sh --self-contained',
    );
  });

  describe('the staging job', () => {
    const block = job('staging');
    const all = steps(block);
    const settings = all.find((s) => s.includes('id: settings')) ?? '';
    const after = all.slice(all.indexOf(settings) + 1);

    it('runs in the staging environment with the archive and service settings', () => {
      expect(block).toMatch(/^ {4}environment: staging$/m);
      for (const name of ['BUCKET', 'ENDPOINT', 'REGION']) {
        expect(block).toContain(
          `WAL_ARCHIVE_${name}: \${{ vars.WAL_ARCHIVE_${name} }}`,
        );
      }
      for (const name of ['KEY', 'SECRET']) {
        expect(block).toContain(
          `WAL_ARCHIVE_${name}: \${{ secrets.WAL_ARCHIVE_${name} }}`,
        );
      }
      expect(block).toContain(
        `RAILWAY_API_TOKEN: \${{ secrets.RAILWAY_API_TOKEN }}`,
      );
      expect(block).toContain(
        `RAILWAY_ENVIRONMENT_ID: \${{ vars.RAILWAY_ENVIRONMENT_ID }}`,
      );
      expect(block).toContain(
        `RAILWAY_SERVICE_POSTGRES: \${{ vars.RAILWAY_SERVICE_POSTGRES }}`,
      );
    });

    it('ends green with a notice while staging has no archive bucket', () => {
      expect(settings).toMatch(/WAL_ARCHIVE_BUCKET/);
      expect(settings).toContain('$GITHUB_OUTPUT');
      const notice = after.find((s) => s.includes('::notice'));
      expect(notice).toContain("if: steps.settings.outputs.skip == 'true'");
    });

    it('runs every other step only once the bucket is set', () => {
      const rest = after.filter((s) => !s.includes('::notice'));

      expect(rest.length).toBeGreaterThan(0);
      for (const step of rest) {
        expect(step).toMatch(/if: .*steps\.settings\.outputs\.skip != 'true'/);
      }
      expect(
        rest.some((s) => /run: bash scripts\/backup\/pitr-drill\.sh$/m.test(s)),
      ).toBe(true);
    });

    it('removes the run’s SSH key however the drill ends', () => {
      const remove = after.find((s) => s.includes('railway ssh keys remove'));

      expect(remove).toMatch(
        /if: always\(\) && steps\.settings\.outputs\.skip != 'true'/,
      );
    });
  });
});

describe('the point-in-time drill script', () => {
  it('drives the image’s own restore, never a restore of its own', () => {
    expect(script).toContain('POSTGRES_RECOVERY_TARGET_TIME');
    for (const name of [
      'BUCKET',
      'ENDPOINT',
      'REGION',
      'KEY',
      'SECRET',
      'PATH',
    ]) {
      expect(script).toContain(`WAL_RECOVER_FROM_${name}`);
    }
    expect(script).not.toMatch(/pgbackrest[^\n]*\brestore\b/);
  });

  it('checks the marker before the target and the one after it', () => {
    expect(script).toContain('pg_xact_commit_timestamp');
    expect(script.match(/pg_xact_status/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('fails past 15 minutes of archive lag and 10 of restore', () => {
    expect(script).toMatch(/^MAX_LAG_SECONDS=900$/m);
    expect(script).toMatch(/^READY_SECONDS=600$/m);
  });

  it('removes everything it started however it ends', () => {
    expect(script).toMatch(/^trap teardown EXIT$/m);
  });

  it('never writes an archive key or secret into a command line', () => {
    expect(script).not.toMatch(/-e "?[A-Z0-9_]*(KEY|SECRET)[A-Z_]*=\$/);
  });
});
