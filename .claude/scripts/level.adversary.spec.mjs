import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkLevel, main, suggestCommand } from './level.mjs';
import { pointTo } from './lib/feature.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function repoFixture({ level = 1, spec = '# Spec\n\n- **FR-001**: one\n', base = {}, branch = {}, feature = true, origin = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adv-level-'));
  dirs.push(dir);
  const write = (files) => {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
  };
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write({
    'apps/api/project.json': '{"name":"api"}',
    'apps/web/project.json': '{"name":"web"}',
    'libs/contracts/project.json': '{"name":"contracts"}',
    'README.md': 'x\n',
    ...base,
  });
  git('add', '-A');
  git('commit', '-qm', 'base');
  if (origin) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-qb', '042-small');
  if (feature) write({ 'specs/042-small/spec.md': spec, 'specs/042-small/tasks.md': '# Tasks\n' });
  write(branch);
  git('add', '-A');
  git('commit', '-qm', 'work');
  mkdirSync(join(dir, '.specify'), { recursive: true });
  writeFileSync(
    join(dir, '.specify/feature.json'),
    JSON.stringify(feature ? { feature_directory: 'specs/042-small', level, level_for: 'specs/042-small' } : { level, level_for: 'next', level_at: new Date().toISOString() }),
  );
  return dir;
}

const frs = (n) => `# Spec\n\n${Array.from({ length: n }, (_, i) => `- **FR-${String(i + 1).padStart(3, '0')}**: requirement ${i}\n`).join('')}`;
const savedLevel = process.env.SPECKIT_FEATURE_LEVEL;
const noEnv = (fn) => {
  delete process.env.SPECKIT_FEATURE_LEVEL;
  try {
    return fn();
  } finally {
    if (savedLevel !== undefined) process.env.SPECKIT_FEATURE_LEVEL = savedLevel;
  }
};
const capture = (fn) => {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    return { status: fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
};
const levelOf = (dir) => JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8')).level;
const autoRun = (dir) => (existsSync(join(dir, 'specs/042-small/auto-run.md')) ? readFileSync(join(dir, 'specs/042-small/auto-run.md'), 'utf8') : '');
const wire = (result, name) => result.wires.find((w) => w.name === name);

describe('the requirement count wire at its boundary', () => {
  it('leaves a spec with exactly five requirements alone', () => {
    const dir = repoFixture({ spec: frs(5) });
    noEnv(() => {
      const result = checkLevel(dir);
      assert.equal(wire(result, 'fr-count').state, 'clear');
      assert.equal(result.promoted, null);
    });
    assert.equal(levelOf(dir), 1);
  });

  it('promotes at six requirements', () => {
    const dir = repoFixture({ spec: frs(6) });
    noEnv(() => assert.deepEqual(checkLevel(dir).promoted, { from: 1, to: 2 }));
    assert.equal(levelOf(dir), 2);
  });

  it('counts a requirement once however often the prose mentions its id', () => {
    const prose = `${frs(3)}\nFR-001 FR-002 FR-003 again: FR-001, FR-002, FR-003.\n\n- Adds: FR-001, FR-002, FR-003\n`;
    const dir = repoFixture({ spec: prose });
    noEnv(() => {
      const result = checkLevel(dir);
      assert.equal(wire(result, 'fr-count').state, 'clear');
      assert.equal(result.promoted, null);
    });
  });

  it('reports a spec with no requirements as clear', () => {
    const dir = repoFixture({ spec: '' });
    noEnv(() => assert.equal(wire(checkLevel(dir), 'fr-count').state, 'clear'));
  });
});

describe('the contract wire names every protected path', () => {
  for (const file of [
    'libs/contracts/src/dto.ts',
    'libs/data-access/src/client.ts',
    'apps/api/openapi.json',
    'libs/domain/src/garage/schema.prisma',
    'libs/domain/prisma/migrations/20260101_init/migration.sql',
  ]) {
    it(`trips on ${file} and logs it`, () => {
      const dir = repoFixture({ branch: { [file]: 'x\n' } });
      noEnv(() => {
        const result = checkLevel(dir);
        assert.equal(wire(result, 'contract').state, 'tripped');
        assert.match(wire(result, 'contract').fact, new RegExp(file.replace(/[.]/g, '\\.')));
        assert.deepEqual(result.promoted, { from: 1, to: 2 });
      });
      assert.match(autoRun(dir), new RegExp(file.replace(/[.]/g, '\\.')));
    });
  }

  it('does not trip on a file that only resembles a contract path', () => {
    const dir = repoFixture({ branch: { 'apps/web/src/libs/contracts-notes.md': 'x\n', 'apps/web/src/schema.prisma.md': 'x\n' } });
    noEnv(() => assert.equal(wire(checkLevel(dir), 'contract').state, 'clear'));
  });
});

describe('the project wire', () => {
  it('counts files outside every project toward no project', () => {
    const dir = repoFixture({ branch: { 'apps/api/src/a.ts': 'x\n', 'docs/notes.md': 'x\n', '.claude/scripts/x.mjs': 'x\n', 'README.md': 'y\n' } });
    noEnv(() => {
      const result = checkLevel(dir);
      assert.equal(wire(result, 'projects').state, 'clear');
      assert.equal(result.promoted, null);
    });
  });

  it('names both projects in the fact and the log line', () => {
    const dir = repoFixture({ branch: { 'apps/api/src/a.ts': 'x\n', 'apps/web/src/b.ts': 'x\n' } });
    noEnv(() => {
      const fact = wire(checkLevel(dir), 'projects').fact;
      assert.match(fact, /api/);
      assert.match(fact, /web/);
    });
    assert.match(autoRun(dir), /api/);
    assert.match(autoRun(dir), /web/);
  });

  it('finds the project of a file with spaces and unicode in its path', () => {
    const dir = repoFixture({ branch: { 'apps/api/src/gar ajă/a b.ts': 'x\n', 'apps/web/src/čé.ts': 'x\n' } });
    noEnv(() => {
      const result = wire(checkLevel(dir), 'projects');
      assert.equal(result.state, 'tripped');
      assert.match(result.fact, /api/);
      assert.match(result.fact, /web/);
    });
  });

  it('finds the nearest project.json for a nested project', () => {
    const dir = repoFixture({
      base: { 'libs/domain/garage/project.json': '{"name":"garage"}', 'libs/domain/project.json': '{"name":"domain"}' },
      branch: { 'libs/domain/garage/src/a.ts': 'x\n', 'libs/domain/src/b.ts': 'x\n' },
    });
    noEnv(() => {
      const fact = wire(checkLevel(dir), 'projects').fact;
      assert.match(fact, /garage/);
      assert.match(fact, /domain/);
    });
  });
});

describe('no wire lowers or touches a level at 2 or 3', () => {
  for (const level of [2, 3]) {
    it(`keeps level ${level} and writes no promotion line with every wire tripped`, () => {
      const dir = repoFixture({
        level,
        spec: `${frs(8)}\n[NEEDS CLARIFICATION: x]\n`,
        branch: { 'libs/contracts/src/dto.ts': 'x\n', 'apps/web/src/b.ts': 'x\n' },
      });
      noEnv(() => {
        const result = checkLevel(dir);
        assert.equal(result.promoted, null);
        assert.equal(result.level, level);
      });
      assert.equal(levelOf(dir), level);
      assert.equal(autoRun(dir), '');
    });
  }

  it('keeps a level 3 through the pre-ready check with an empty missing list', () => {
    const dir = repoFixture({ level: 3, branch: { 'libs/contracts/src/dto.ts': 'x\n', 'specs/042-small/plan.md': '# Plan\n' } });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
    assert.equal(levelOf(dir), 3);
  });
});

describe('promotion log', () => {
  it('appends to an existing auto-run.md without dropping its content', () => {
    const dir = repoFixture({ spec: frs(6), branch: { 'specs/042-small/auto-run.md': '# Auto run\n\n- earlier line\n' } });
    noEnv(() => checkLevel(dir));
    const text = autoRun(dir);
    assert.match(text, /^# Auto run/);
    assert.match(text, /- earlier line/);
    assert.match(text, /level 1 → 2/);
  });

  it('logs one line when two wires trip together', () => {
    const dir = repoFixture({ spec: `${frs(6)}\n[NEEDS CLARIFICATION: x]\n`, branch: { 'libs/contracts/src/a.ts': 'x\n' } });
    noEnv(() => checkLevel(dir));
    const lines = autoRun(dir).trim().split('\n').filter((l) => /level 1 → 2/.test(l));
    assert.equal(lines.length, 1);
  });

  it('does not log twice when the check runs three times', () => {
    const dir = repoFixture({ spec: frs(7) });
    noEnv(() => {
      checkLevel(dir);
      checkLevel(dir);
      checkLevel(dir);
    });
    assert.equal(autoRun(dir).trim().split('\n').length, 1);
  });
});

describe('a diff that cannot be computed', () => {
  it('reports the diff wires as not checked and neither promotes nor refuses ready', () => {
    const dir = repoFixture({ origin: false, branch: { 'libs/contracts/src/dto.ts': 'x\n', 'apps/web/src/b.ts': 'x\n', 'apps/api/src/a.ts': 'x\n' } });
    noEnv(() => {
      const result = checkLevel(dir, { ready: true });
      assert.equal(wire(result, 'contract').state, 'not checked');
      assert.equal(wire(result, 'projects').state, 'not checked');
      assert.equal(result.promoted, null);
      assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0);
    });
    assert.equal(levelOf(dir), 1);
  });

  it('still promotes on the spec wires when the diff is unavailable', () => {
    const dir = repoFixture({ origin: false, spec: frs(6) });
    noEnv(() => {
      const result = checkLevel(dir);
      assert.equal(wire(result, 'projects').state, 'not checked');
      assert.deepEqual(result.promoted, { from: 1, to: 2 });
    });
  });

  it('makes no too-heavy mark at level 2 when the diff is unavailable', () => {
    const dir = repoFixture({ level: 2, origin: false, branch: { 'apps/web/src/b.ts': 'x\n', 'specs/042-small/plan.md': '# Plan\n' } });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
    assert.equal(existsSync(join(dir, '.specify/telemetry/pending.json')), false);
  });
});

describe('the too heavy mark at level 2', () => {
  const pending = (dir) => JSON.parse(readFileSync(join(dir, '.specify/telemetry/pending.json'), 'utf8'));

  it('ignores specs and .specify files when counting the one file', () => {
    const dir = repoFixture({
      level: 2,
      branch: { 'apps/web/src/b.ts': 'x\n', 'specs/042-small/plan.md': '# Plan\n', 'specs/042-small/research.md': 'r\n', '.specify/memory/n.md': 'n\n' },
    });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
    assert.equal(pending(dir).too_heavy[0].file, 'apps/web/src/b.ts');
  });

  it('writes no mark for a two-file diff', () => {
    const dir = repoFixture({ level: 2, branch: { 'apps/web/src/b.ts': 'x\n', 'apps/web/src/c.ts': 'x\n', 'specs/042-small/plan.md': '# Plan\n' } });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
    assert.equal(existsSync(join(dir, '.specify/telemetry/pending.json')), false);
  });

  it('writes no mark when the branch changes nothing outside specs', () => {
    const dir = repoFixture({ level: 2, branch: { 'specs/042-small/plan.md': '# Plan\n' } });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
    assert.equal(existsSync(join(dir, '.specify/telemetry/pending.json')), false);
  });

  it('writes no mark for a one-file migration or schema diff', () => {
    for (const file of ['libs/domain/prisma/migrations/1/migration.sql', 'libs/domain/src/x/schema.prisma', 'apps/api/openapi.json']) {
      const dir = repoFixture({ level: 2, branch: { [file]: 'x\n', 'specs/042-small/plan.md': '# Plan\n' } });
      noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
      assert.equal(existsSync(join(dir, '.specify/telemetry/pending.json')), false, file);
    }
  });

  it('keeps the level at 2 and gives no refusal', () => {
    const dir = repoFixture({ level: 2, branch: { 'apps/web/src/b.ts': 'x\n', 'specs/042-small/plan.md': '# Plan\n' } });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 0));
    assert.equal(levelOf(dir), 2);
  });
});

describe('the pre-ready refusal', () => {
  it('reports missing plan.md and the owed phases in --json with exit 2', () => {
    const dir = repoFixture({ branch: { 'apps/api/src/a.ts': 'x\n', 'apps/web/src/b.ts': 'x\n' } });
    noEnv(() => {
      const run = capture(() => main(['check', '--ready', '--json'], dir));
      assert.equal(run.status, 2);
      const parsed = JSON.parse(run.out);
      assert.deepEqual(parsed.promoted, { from: 1, to: 2 });
      assert.deepEqual(parsed.missing, ['plan.md']);
      assert.deepEqual(parsed.owed, ['context', 'clarify', 'plan', 'checklist', 'analyze', 'converge', 'refresh', 'agent-context', 'archive']);
    });
  });

  it('keeps refusing on every rerun until plan.md exists, logging the promotion once', () => {
    const dir = repoFixture({ branch: { 'libs/contracts/src/a.ts': 'x\n' } });
    noEnv(() => {
      assert.equal(capture(() => main(['check', '--ready'], dir)).status, 2);
      assert.equal(capture(() => main(['check', '--ready'], dir)).status, 2);
      assert.equal(capture(() => main(['check', '--ready'], dir)).status, 2);
    });
    assert.equal(autoRun(dir).trim().split('\n').length, 1);
    assert.equal(levelOf(dir), 2);
  });

  it('refuses a feature already at level 2 that is missing plan.md, without a new promotion line', () => {
    const dir = repoFixture({ level: 2, branch: { 'libs/contracts/src/a.ts': 'x\n' } });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 2));
    assert.equal(autoRun(dir), '');
  });

  it('refuses a promoted level 0 feature with a directory and tripped spec wires too', () => {
    const dir = repoFixture({ level: 0, spec: frs(6) });
    noEnv(() => assert.equal(capture(() => main(['check', '--ready'], dir)).status, 2));
    assert.equal(levelOf(dir), 2);
  });

  it('passes a level 1 whose wires are clear with exit 0 and no output on stderr', () => {
    const dir = repoFixture({ branch: { 'apps/api/src/a.ts': 'x\n' } });
    noEnv(() => {
      const run = capture(() => main(['check', '--ready'], dir));
      assert.equal(run.status, 0);
      assert.equal(run.err, '');
    });
  });
});

describe('the check as a command', () => {
  const SCRIPT = new URL('./level.mjs', import.meta.url).pathname;
  it('exits 2 from the shell on a refusal and prints JSON on stdout', () => {
    const dir = repoFixture({ branch: { 'libs/contracts/src/a.ts': 'x\n' } });
    const run = spawnSync(process.execPath, [SCRIPT, 'check', '--ready', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, SPECKIT_FEATURE_LEVEL: '', CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(run.status, 2);
    assert.deepEqual(JSON.parse(run.stdout).missing, ['plan.md']);
  });
});

const rich = (text) => [{ plain_text: text }];
const storyPage = ({ type = 'Story', boards = 0, points = null, labels = [], title = 'Fix the garage list sort order' } = {}) => ({
  id: 'page-1',
  properties: {
    Story: { type: 'title', title: rich(title) },
    ...(type === null ? {} : { 'Issue type': { type: 'select', select: { name: type } } }),
    Labels: { type: 'multi_select', multi_select: labels.map((name) => ({ name })) },
    Design: { type: 'rollup', rollup: { type: 'array', array: [] } },
    'Design boards': { type: 'rollup', rollup: { type: 'array', array: Array.from({ length: boards }, () => ({ type: 'url', url: 'https://x' })) } },
    ...(points === null ? {} : { 'Story points': { type: 'number', number: points } }),
  },
});
const h = (n, text) => ({ type: `heading_${n}`, [`heading_${n}`]: { rich_text: rich(text) }, has_children: false });
const para = (text) => ({ type: 'paragraph', paragraph: { rich_text: rich(text) }, has_children: false });
const brief = (filled = true) => [h(2, 'Build brief'), h(3, 'Screens'), para('the list'), h(3, 'States and errors'), ...(filled ? [para('empty list')] : []), h(2, 'Notes'), para('x')];

function notionFake({ page, blocks = [], fail, status } = {}) {
  const urls = [];
  const fetchImpl = async (url, init = {}) => {
    urls.push(url);
    const reply = (code, data) => ({ ok: code < 300, status: code, json: async () => data, headers: { get: () => null } });
    if (fail === 'network') throw new Error('ECONNREFUSED');
    if (status) return reply(status, { code: 'unauthorized', message: 'nope' });
    if (url.includes('/data_sources/') && init.method === 'POST') return reply(200, { results: page ? [page] : [], has_more: false });
    if (url.includes('/blocks/')) return reply(200, { results: blocks, has_more: false });
    if (url.includes('/pages/')) return page ? reply(200, page) : reply(404, { code: 'object_not_found', message: 'not found' });
    return reply(500, { code: 'unexpected', message: url });
  };
  return { fetchImpl, urls };
}

async function suggest(argv, { fake, env = { NOTION_TOKEN: 'secret_t' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adv-suggest-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.specify'), { recursive: true });
  const out = [];
  const previous = process.env.SPECKIT_JEV;
  process.env.SPECKIT_JEV = '0';
  try {
    const status = await suggestCommand(argv, { repo: dir, env, fetchImpl: fake?.fetchImpl, out: (line) => out.push(line) });
    return { status, out: out.join('\n'), lines: out, dir };
  } finally {
    if (previous === undefined) delete process.env.SPECKIT_JEV;
    else process.env.SPECKIT_JEV = previous;
  }
}
const levelPrinted = (text) => {
  const m = text.match(/level (\d)/);
  return m ? Number(m[1]) : null;
};

describe('sizing from a Notion story at the rule boundaries', () => {
  it('does not raise a bug at exactly five story points', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug', points: 5 }), blocks: brief() }) });
    assert.equal(run.status, 0);
    assert.match(run.out, /level 1 \(one-session\) suggested by notion/);
  });

  it('raises a bug at six story points to at least 2 and names the points', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug', points: 6 }), blocks: brief() }) });
    assert.ok(levelPrinted(run.out) >= 2, run.out);
    assert.match(run.out, /points/);
    assert.match(run.out, /6/);
  });

  it('raises a bug with design boards to at least 2 and names the boards', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug', boards: 2 }), blocks: brief() }) });
    assert.ok(levelPrinted(run.out) >= 2, run.out);
    assert.match(run.out, /boards/);
  });

  it('treats a whitespace-only section as empty and names it', async () => {
    const blocks = [h(2, 'Build brief'), h(3, 'Screens'), para('   '), h(3, 'States and errors'), para('x')];
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug' }), blocks }) });
    assert.ok(levelPrinted(run.out) >= 2, run.out);
    assert.match(run.out, /Screens/);
  });

  it('treats a page with no Build brief heading as an empty brief reported as not found', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug' }), blocks: [h(2, 'Notes'), para('x')] }) });
    assert.ok(levelPrinted(run.out) >= 2, run.out);
    assert.match(run.out, /brief: not found/);
  });

  it('treats a page with no blocks at all as an empty brief', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug' }), blocks: [] }) });
    assert.ok(levelPrinted(run.out) >= 2, run.out);
  });

  it('prints unsure for a story with no boards and a complete brief, then continues with the text path', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Story' }), blocks: brief() }) });
    assert.equal(run.status, 0);
    assert.match(run.out, /unsure/);
    assert.match(run.out, /facts:/);
    assert.ok(run.lines.length > 2, 'the text path adds its own output');
  });

  it('prints unsure for an unnamed issue type with no boards and a complete brief', async () => {
    for (const type of ['Decision', 'Tech debt']) {
      const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type }), blocks: brief() }) });
      assert.match(run.out, /unsure/, type);
    }
  });

  it('still raises a decision with boards to at least 2', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Decision', boards: 1 }), blocks: brief() }) });
    assert.ok(levelPrinted(run.out) >= 2, run.out);
  });

  it('lets labels decide nothing', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: storyPage({ type: 'Bug', labels: ['ui', 'epic-big', 'breaking'] }), blocks: brief() }) });
    assert.match(run.out, /level 1 \(one-session\) suggested by notion/);
    assert.match(run.out, /ui/);
  });

  it('survives a page with no properties at all and sizes it no lower than 2', async () => {
    const run = await suggest(['ST-9'], { fake: notionFake({ page: { id: 'p', properties: {} }, blocks: [] }) });
    assert.equal(run.status, 0);
    assert.doesNotMatch(run.out, /level [01] .*suggested by notion/);
  });

  it('reads a story by its Notion URL', async () => {
    const fake = notionFake({ page: storyPage({ type: 'Bug' }), blocks: brief() });
    const run = await suggest(['https://app.notion.com/p/3f0607bff0d2817d8a94d9a31fa161b4'], { fake });
    assert.equal(run.status, 0);
    assert.match(run.out, /level 1 \(one-session\) suggested by notion/);
  });
});

describe('sizing when Notion cannot be read', () => {
  const sameAsText = async (fake, env) => {
    const failing = await suggest(['ST-9'], { fake, env });
    const plain = await suggest(['ST-9'], { env: {} });
    const plainTail = plain.lines.slice(1).join('\n');
    assert.equal(failing.status, 0);
    assert.match(failing.lines[0], /notion not read/);
    assert.equal(failing.lines.filter((l) => /notion not read/.test(l)).length, 1);
    assert.equal(failing.lines.slice(1).join('\n'), plainTail);
    return failing;
  };

  it('falls back after one line on a network failure', async () => {
    await sameAsText(notionFake({ fail: 'network' }));
  });

  it('falls back after one line when the page is not found', async () => {
    await sameAsText(notionFake({ page: null }));
  });

  it('falls back after one line on a rejected token', async () => {
    await sameAsText(notionFake({ status: 401 }));
  });

  it('falls back without calling Notion when there is no token', async () => {
    const fake = notionFake({ page: storyPage({ type: 'Bug' }), blocks: brief() });
    const run = await suggest(['ST-9'], { fake, env: {} });
    assert.equal(run.status, 0);
    assert.match(run.lines[0], /notion not read/);
    assert.equal(fake.urls.length, 0);
  });

  it('falls back on an empty token string', async () => {
    const fake = notionFake({ page: storyPage({ type: 'Bug' }), blocks: brief() });
    const run = await suggest(['ST-9'], { fake, env: { NOTION_TOKEN: '' } });
    assert.match(run.lines[0], /notion not read/);
    assert.equal(fake.urls.length, 0);
  });
});

describe('suggest --set only records a confident answer', () => {
  it('writes nothing to feature.json when the Notion verdict is unsure and the text path is not confident', async () => {
    const fake = notionFake({ page: storyPage({ type: 'Story', title: 'Improve things' }), blocks: brief() });
    const run = await suggest(['ST-9', '--set'], { fake });
    assert.equal(run.status, 0);
    assert.equal(existsSync(join(run.dir, '.specify/feature.json')), false);
  });

  it('writes nothing when Notion cannot be read and the text is vague', async () => {
    const run = await suggest(['ST-9', '--set'], { fake: notionFake({ fail: 'network' }) });
    assert.equal(run.status, 0);
    assert.equal(existsSync(join(run.dir, '.specify/feature.json')), false);
  });
});

describe('a level_at without a zone is no waiting level, in both readers', () => {
  const NOW = Date.parse('2026-10-06T20:19:13Z');
  const pyProbe = spawnSync('python3', ['--version']);
  const pyIt = pyProbe.status === 0 ? it : it.skip;

  const jsPoint = (levelAt) =>
    pointTo({ level: 3, level_for: 'next', level_at: levelAt }, 'specs/050-new', { now: NOW, env: {} });

  const pyPoint = (levelAt) => {
    const dir = mkdtempSync(join(tmpdir(), 'adv-zone-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.specify'), { recursive: true });
    writeFileSync(join(dir, '.specify/feature.json'), JSON.stringify({ level: 3, level_for: 'next', level_at: levelAt }));
    const code = [
      'import sys, time, pathlib',
      `sys.path.insert(0, ${JSON.stringify(join(process.cwd(), '.specify/scripts/python'))})`,
      'import common',
      `time.time = lambda: ${NOW / 1000}`,
      `common.persist_feature_json(pathlib.Path(${JSON.stringify(dir)}), 'specs/050-new')`,
    ].join('\n');
    const run = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8'));
  };

  const zoneless = ['2026-10-06T20:18:13', '2026-10-06', '2026-10-06T20:18:13.123', '2026-10-06 20:18:13', '2026-10-06T20:18'];
  for (const stamp of zoneless) {
    it(`drops the level for ${JSON.stringify(stamp)} in JS`, () => {
      assert.deepEqual(jsPoint(stamp), { feature_directory: 'specs/050-new' });
    });
    pyIt(`drops the level for ${JSON.stringify(stamp)} in Python`, () => {
      assert.deepEqual(pyPoint(stamp), { feature_directory: 'specs/050-new' });
    });
  }

  const zoned = ['2026-10-06T20:18:13Z', '2026-10-06T20:18:13+00:00', '2026-10-06T22:18:13+02:00', '2026-10-06T15:18:13-05:00', '2026-10-06T20:18:13.123Z', '2026-10-06T20:18:13.5Z'];
  for (const stamp of zoned) {
    pyIt(`JS and Python agree on ${JSON.stringify(stamp)}`, () => {
      assert.deepEqual(pyPoint(stamp), jsPoint(stamp));
    });
  }

  it('keeps a Z stamp fresh in JS', () => {
    assert.deepEqual(jsPoint('2026-10-06T20:18:13Z'), { feature_directory: 'specs/050-new', level: 3, level_for: 'specs/050-new' });
  });

  it('refuses a date followed by an offset with no time', () => {
    assert.deepEqual(jsPoint('2026-10-06-05:00'), { feature_directory: 'specs/050-new' });
  });

  it('refuses a non-string level_at', () => {
    assert.deepEqual(jsPoint(NOW), { feature_directory: 'specs/050-new' });
  });
});
