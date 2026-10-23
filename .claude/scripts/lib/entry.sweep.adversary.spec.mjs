import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLAUDE = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const REPO = join(CLAUDE, '..');

const grep = (pattern) => {
  const out = spawnSync('git', ['grep', '-nE', pattern, '--', '.claude', ':!.claude/**/specs/**', ':!*.spec.*', ':!*.md', ':!*.sh'], { cwd: REPO, encoding: 'utf8' });
  return out.stdout.split('\n').filter(Boolean);
};

describe('no script compares its own path by hand', () => {
  // @traces 486-FR-001
  it('leaves process.argv[1] to lib/entry.mjs alone', () => {
    const hits = grep('process\\.argv\\[1\\]').filter((l) => !l.startsWith('.claude/scripts/lib/entry.mjs:'));
    assert.deepEqual(hits, []);
  });

  // @traces 486-FR-001
  it('has no file:// comparison against the argument it was started with', () => {
    assert.deepEqual(grep('file://\\$\\{process\\.argv|pathToFileURL\\(process\\.argv'), []);
  });

  // @traces 486-FR-001
  it('has no destructured argv entry compared with import.meta.url', () => {
    const hits = grep('=== *import\\.meta\\.url|import\\.meta\\.url *===|import\\.meta\\.filename *===|=== *import\\.meta\\.filename');
    assert.deepEqual(hits, []);
  });
});

describe('guarded CLIs through a symlinked folder', () => {
  // @traces 486-FR-001
  it('runs the main block of status.mjs through a symlinked .claude as through the real one', () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'entry-sweep-')));
    try {
      const link = join(scratch, 'claude-link');
      symlinkSync(CLAUDE, link);
      const run = (path) => spawnSync(process.execPath, [join(path, 'scripts', 'status.mjs'), '--help'], { cwd: REPO, encoding: 'utf8' });
      const real = run(CLAUDE);
      const via = run(link);
      assert.equal(via.status, real.status);
      assert.equal(via.stdout, real.stdout);
      assert.notEqual(real.stdout + real.stderr, '', 'status.mjs printed nothing even by its real path');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 90000);

  // @traces 486-FR-001
  it('imports isEntryPoint from lib/entry.mjs in every file that calls it', () => {
    const files = execFileSync('git', ['ls-files', '.claude'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.mjs$/.test(f) && !/\.spec\.mjs$/.test(f) && f !== '.claude/scripts/lib/entry.mjs');
    const bad = files.filter((f) => {
      const body = readFileSync(join(REPO, f), 'utf8');
      return /isEntryPoint\(/.test(body) && !/import[^;]*isEntryPoint[^;]*from\s+["'][^"']*entry\.mjs["']/.test(body);
    });
    assert.deepEqual(bad, []);
  });
});
