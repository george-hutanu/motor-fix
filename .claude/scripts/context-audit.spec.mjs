import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  audit,
  baselinePath,
  contextFileName,
  measure,
  ratchet,
  readBaseline,
  main,
} from './context-audit.mjs';
import { verdict } from '../hooks/config-protection.mjs';

function fixture(claudeMd, baseline) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-context-'));
  mkdirSync(join(dir, '.specify'), { recursive: true });
  if (claudeMd !== undefined) writeFileSync(join(dir, 'CLAUDE.md'), claudeMd);
  if (baseline !== undefined) writeFileSync(baselinePath(dir), JSON.stringify(baseline));
  return dir;
}

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

const lines = (n) => Array.from({ length: n }, (_, i) => `- rule number ${i + 1}`).join('\n');

describe('measuring the context file', () => {
  it('counts non-empty lines, ignoring blank ones', () => {
    assert.equal(measure('a\n\n\nb\n').total.lines, 2);
  });

  it('measures the managed block separately', () => {
    const text = ['manual line', '<!-- SPECKIT START -->', 'managed one', 'managed two', '<!-- SPECKIT END -->'].join('\n');
    const m = measure(text);
    assert.equal(m.total.lines, 5);
    assert.equal(m.managed.lines, 2);
  });

  it('reports an empty managed block when the markers are absent', () => {
    assert.equal(measure('just prose\n').managed.lines, 0);
  });
});

describe('the ratchet', () => {
  it('has nothing to say before a baseline exists', () => {
    assert.equal(ratchet(measure('a\n'), null).state, 'unset');
  });

  it('blocks growth and reports by how much', () => {
    const v = ratchet(measure(lines(12)), { lines: 10 });
    assert.equal(v.state, 'grown');
    assert.equal(v.delta, 2);
    assert.match(v.message, /from 10 to 12/);
  });

  it('welcomes shrinking and says to re-bless', () => {
    const v = ratchet(measure(lines(8)), { lines: 10 });
    assert.equal(v.state, 'shrunk');
    assert.match(v.message, /re-bless/);
  });

  it('treats holding exactly at the baseline as passing', () => {
    assert.equal(ratchet(measure(lines(10)), { lines: 10 }).state, 'held');
  });

  it('ignores a malformed baseline rather than blocking every edit', () => {
    const dir = fixture(lines(3));
    try {
      writeFileSync(baselinePath(dir), 'not json');
      assert.equal(readBaseline(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('auditing which lines still earn their place', () => {
  it('flags strikethrough as history, which changes no behaviour', () => {
    const findings = audit('- ~~PrimeNG 22.1.1~~ — removed by a later feature\n');
    assert.ok(findings.some((f) => f.rule === 'history'));
  });

  it('flags prose about a past state', () => {
    assert.ok(audit('- The launcher was replaced by a different one.\n').some((f) => f.rule === 'history'));
  });

  it('flags a backticked repository path that no longer exists', () => {
    const dir = fixture('- see `src/gone.js` for the rule\n');
    try {
      const findings = audit(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), { repo: dir });
      assert.deepEqual(findings.map((f) => f.rule), ['dead-reference']);
      assert.match(findings[0].message, /src\/gone\.js/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag a placeholder path — it states a rule, not a file', () => {
    // `packages/<name>/` describes constitution IV's carve-out. Flagging it
    // would train everyone to ignore this rule.
    const dir = fixture('- a `packages/<name>/` companion may carry runtime dependencies\n');
    try {
      assert.deepEqual(audit(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), { repo: dir }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag a path that exists', () => {
    const dir = fixture('- storage lives in `src/store.js`\n');
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/store.js'), '');
      assert.deepEqual(audit(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), { repo: dir }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a line that only names a path and says nothing about it', () => {
    assert.ok(audit('- `src/commands/add.js`\n').some((f) => f.rule === 'derivable'));
  });

  it('flags a line copied verbatim out of the constitution', () => {
    const rule = 'Every feature is reachable via the CLI, with positional arguments for required input.';
    assert.ok(audit(`- ${rule}\n`, { constitution: `- ${rule}\n` }).some((f) => f.rule === 'duplicate'));
  });

  it('says nothing about a file whose every line states a current rule', () => {
    assert.deepEqual(audit('- Tests live in tests/ and use node:test.\n'), []);
  });
});

describe('the context-audit command', () => {
  it('refuses to bless growth without a reason, and records it with one', () => {
    const dir = fixture(lines(12), { lines: 10 });
    try {
      const refused = capture(() => main(['--bless'], dir));
      assert.equal(refused.status, 1);
      assert.match(refused.err, /refusing to bless growth/);
      assert.equal(readBaseline(dir).lines, 10, 'a refused bless must not move the baseline');

      const missingReason = capture(() => main(['--bless', '--allow-growth'], dir));
      assert.equal(missingReason.status, 1);
      assert.match(missingReason.err, /needs a reason/);

      const blessed = capture(() => main(['--bless', '--allow-growth', 'six new harness commands'], dir));
      assert.equal(blessed.status, 0);
      assert.equal(readBaseline(dir).lines, 12);
      assert.equal(readBaseline(dir).growth_reason, 'six new harness commands');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blesses a shrink with no ceremony', () => {
    const dir = fixture(lines(4), { lines: 10 });
    try {
      assert.equal(capture(() => main(['--bless'], dir)).status, 0);
      assert.equal(readBaseline(dir).lines, 4, 'the ratchet tightens when the file shrinks');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails --check on growth and passes it otherwise', () => {
    const grown = fixture(lines(12), { lines: 10 });
    const held = fixture(lines(10), { lines: 10 });
    try {
      assert.equal(capture(() => main(['--check'], grown)).status, 1);
      assert.equal(capture(() => main(['--check'], held)).status, 0);
    } finally {
      rmSync(grown, { recursive: true, force: true });
      rmSync(held, { recursive: true, force: true });
    }
  });

  it('never fails --check on audit findings alone — they need a human to judge', () => {
    const dir = fixture(`${lines(3)}\n- ~~something~~ was removed\n`, { lines: 100 });
    try {
      const result = capture(() => main(['--check'], dir));
      assert.equal(result.status, 0);
      assert.match(result.out, /history/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing context file instead of assuming an empty one', () => {
    const dir = fixture(undefined);
    try {
      assert.equal(capture(() => main([], dir)).status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the hook that enforces the ratchet', () => {
  const args = (next, over = {}) => ({
    rel: 'CLAUDE.md',
    contextFile: 'CLAUDE.md',
    current: lines(10),
    next,
    profile: 'standard',
    allowHookEdit: false,
    contextBaseline: { lines: 10 },
    allowContextGrowth: false,
    ...over,
  });

  it('blocks an edit that takes the file past the baseline', () => {
    const reason = verdict(args(lines(11)));
    assert.match(reason, /ratchet in the shrinking direction/);
    assert.match(reason, /from 10 to 11/);
    assert.match(reason, /--allow-growth/, 'the block names the deliberate way through');
  });

  it('allows an edit that shrinks or holds the file', () => {
    assert.equal(verdict(args(lines(9))), null);
    assert.equal(verdict(args(lines(10))), null);
  });

  it('allows growth when it was made deliberate', () => {
    assert.equal(verdict(args(lines(20), { allowContextGrowth: true })), null);
  });

  it('says nothing before a baseline exists', () => {
    assert.equal(verdict(args(lines(50), { contextBaseline: null })), null);
  });

  it('leaves every other file to the rules that already covered it', () => {
    assert.equal(verdict(args(lines(50), { rel: 'README.md' })), null);
  });

  it('ratchets whichever file this repository actually uses for context', () => {
    // The sibling repository keeps a tracked-but-empty CLAUDE.md and its real
    // guidance in CLAUDE.local.md. The rule has to follow the file that holds
    // the rules, not the name this repository happens to use.
    const reason = verdict(args(lines(11), { rel: 'CLAUDE.local.md', contextFile: 'CLAUDE.local.md' }));
    assert.match(reason, /CLAUDE\.local\.md is a ratchet/);
    assert.equal(verdict(args(lines(11), { rel: 'CLAUDE.md', contextFile: 'CLAUDE.local.md' })), null);
  });
});

describe('choosing the context file', () => {
  it('prefers CLAUDE.md when it has content', () => {
    const dir = fixture('a rule\n');
    try {
      assert.equal(contextFileName(dir), 'CLAUDE.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips an empty CLAUDE.md for the local file that holds the rules', () => {
    const dir = fixture('');
    try {
      writeFileSync(join(dir, 'CLAUDE.local.md'), 'the real rules\n');
      assert.equal(contextFileName(dir), 'CLAUDE.local.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to AGENTS.md, and reports none when nothing has content', () => {
    const dir = fixture(undefined);
    try {
      assert.equal(contextFileName(dir), null);
      writeFileSync(join(dir, 'AGENTS.md'), 'shared guidance\n');
      assert.equal(contextFileName(dir), 'AGENTS.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- the jev lane -----------------------------------------------------------
// Injected transport and an explicit key: the lane must be exercised without
// a network and without depending on whether this machine has credentials.
const jevReply = (answers) => async () => ({ ok: true, json: async () => ({ answers, usage: { input_tokens: 1, output_tokens: 1 } }) });
const withKey = async (fn) => {
  const saved = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test-key';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
};

describe('blocks', () => {
  it('splits on blank lines and keeps a bullet with its wrapped continuation', async () => {
    const { blocks } = await import('./context-audit.mjs');
    const found = blocks('# Title\n\n- a rule that wraps\n  onto a second line\n\nA paragraph.\n');
    assert.deepEqual(found.map((b) => b.line), [3, 6]);
    assert.match(found[0].text, /wraps\n  onto a second line/);
  });

  it('keeps a fenced example whole, blank lines and all', async () => {
    const { blocks } = await import('./context-audit.mjs');
    const found = blocks('```\nnpm test\n\nnpm run lint\n```\n');
    assert.equal(found.length, 1);
    assert.match(found[0].text, /npm run lint/);
  });
});

describe('jevAudit', () => {
  it('reports only the blocks the inclusion test calls inert, weakest first', async () => {
    const { jevAudit } = await import('./context-audit.mjs');
    const text = 'Rule: always do X.\n\nBackground prose.\n\nMore history.\n';
    const result = await withKey(() =>
      jevAudit(text, {
        repo: '/nonexistent',
        fetchImpl: jevReply({ b_1: { noul: 0.9 }, b_3: { noul: 0.25 }, b_5: { noul: 0.05 } }),
      }),
    );
    assert.equal(result.unavailable, false);
    assert.deepEqual(result.findings.map((f) => f.line), [5, 3]);
    assert.equal(result.findings[0].rule, 'inert');
  });

  it('says the lane is unavailable rather than reporting a clean file', async () => {
    const { jevAudit } = await import('./context-audit.mjs');
    const result = await withKey(() =>
      jevAudit('A line.\n', { repo: '/nonexistent', fetchImpl: async () => ({ ok: false, status: 500 }) }),
    );
    assert.equal(result.unavailable, true);
    assert.deepEqual(result.findings, []);
    assert.match(result.note, /unavailable/);
  });
});
