import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkMerge, parseCapability, planMerge, validateFeature } from './capabilities.mjs';

// Requirement tokens are assembled at runtime so the trace matrix does not scan them.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-adv-'));
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dir;
}

const capability = (slug, requirements = [], retired = []) =>
  [
    '---',
    `capability: ${slug}`,
    'updated: 2026-01-01',
    'features:',
    '---',
    '',
    `# Capability: ${slug}`,
    '',
    '## Requirements',
    '',
    ...requirements.flatMap(([token, text]) => [`### ${token} — ${text}`, '', `_From ${token.slice(0, 3)}-x._`, '']),
    '## Retired',
    '',
    ...retired.map(([token, why]) => `- \`${token}\` — ${why}`),
    '',
  ].join('\n');

const DELTA = '### Capability: `cli-tasks`\n\n- **Adds**: FR-001';

const spec = ({ head = '', frs = [['FR-001', 'adds a flag']], delta = DELTA, extra = '' } = {}) =>
  [
    '# Feature Specification: Fixture',
    '',
    head,
    '',
    '## Requirements',
    '',
    ...frs.map(([id, text]) => `- **${id}**: ${text}`),
    extra,
    '',
    ...(delta ? ['## Spec Delta', '', delta, ''] : []),
    '## Success Criteria',
    '',
    '- SC-001: it works',
    '',
  ].join('\n');

// delta-all-adds (a WARN on every Adds-only delta) is not what these cases judge.
const rulesOf = (findings) => findings.map((f) => f.rule).filter((r) => r !== 'delta-all-adds').sort();

function validate(specText, caps) {
  const files = { 'specs/002-fixture/spec.md': specText };
  for (const [slug, reqs, retired] of caps ?? [['cli-tasks', [[T('002', '001'), 'adds a flag']]]]) {
    files[`.specify/capabilities/${slug}.md`] = capability(slug, reqs, retired);
  }
  const dir = fixture(files);
  try {
    return validateFeature(dir, { dir: join(dir, 'specs', '002-fixture'), name: '002-fixture', num: '002' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const existing = (findings) => findings.find((f) => f.rule === 'delta-adds-existing');

describe('what marks a feature archived', () => {
  // @traces 845-FR-001
  it('accepts an archived status with a trailing date in other shapes', () => {
    for (const status of [
      '**Status**: Archived 2026-10-07',
      '**Status**: Archived (2026-10-07)',
      '**Status**: Archived — 2026-10-07',
      '**Status**:   Archived',
      '**Status**: Archived   ',
    ]) {
      assert.equal(existing(validate(spec({ head: status }))), undefined, status);
    }
  });

  // @traces 845-FR-001
  it('accepts the status line with Windows line endings', () => {
    const text = spec({ head: '**Status**: Archived (2026-10-07)' }).replace(/\n/g, '\r\n');
    assert.equal(existing(validate(text)), undefined);
  });

  // @traces 845-FR-001
  it('accepts the status line among the other header fields', () => {
    const head = '**Feature Branch**: `002-fixture`\n**Created**: 2026-10-01\n**Status**: Archived (2026-10-07)\n**Input**: x';
    assert.equal(existing(validate(spec({ head }))), undefined);
  });

  // @traces 845-FR-002
  it('does not treat a word that merely starts with Archived as archived', () => {
    for (const status of ['**Status**: Archivedish', '**Status**: Archived-pending', '**Status**: ArchivedX (2026-10-07)', '**Status**: Archive']) {
      assert.equal(existing(validate(spec({ head: status })))?.level, 'ERROR', status);
    }
  });

  // @traces 845-FR-002
  it('does not treat a different status that mentions Archived as archived', () => {
    for (const status of ['**Status**: Draft (to be Archived)', '**Status**: Unarchived', '**Status**: Not Archived', '**Status**: Draft Archived']) {
      assert.equal(existing(validate(spec({ head: status })))?.level, 'ERROR', status);
    }
  });

  // @traces 845-FR-002
  it('ignores an Archived status line quoted inside the body', () => {
    const quoted = spec({ head: '**Status**: Draft', extra: '\n> **Status**: Archived\n' });
    assert.equal(existing(validate(quoted))?.level, 'ERROR');
    const indented = spec({ head: '**Status**: Draft', extra: '\n    **Status**: Archived\n' });
    assert.equal(existing(validate(indented))?.level, 'ERROR');
  });

  // @traces 845-FR-002
  it('ignores a paragraph that mentions the Archived status mid-sentence', () => {
    const extra = '\nWhen done the line reads **Status**: Archived and nothing else.\n';
    assert.equal(existing(validate(spec({ head: '**Status**: Draft', extra })))?.level, 'ERROR');
  });

  // @traces 845-FR-002
  it('ignores an Archived status line inside a fenced code block', () => {
    const extra = '\n```\n**Status**: Archived\n```\n';
    assert.equal(existing(validate(spec({ head: '**Status**: Draft', extra })))?.level, 'ERROR');
  });

  // @traces 845-FR-002
  it('treats a spec with no status line at all as not archived', () => {
    assert.equal(existing(validate(spec()))?.level, 'ERROR');
  });

  // @traces 845-FR-002
  it('treats the word Archived without the status label as not archived', () => {
    assert.equal(existing(validate(spec({ head: 'Archived' })))?.level, 'ERROR');
    assert.equal(existing(validate(spec({ head: '**Archived**: yes' })))?.level, 'ERROR');
  });

  // @traces 845-FR-001
  it('accepts the status in lower and upper case', () => {
    for (const status of ['**Status**: archived', '**Status**: ARCHIVED']) {
      assert.equal(existing(validate(spec({ head: status }))), undefined, status);
    }
  });
});

describe('an archived feature across several capabilities', () => {
  const two = [
    ['cli-tasks', [[T('002', '001'), 'adds a flag']]],
    ['platform', [[T('002', '002'), 'adds a gate']]],
  ];
  const delta = '### Capability: `cli-tasks`\n\n- **Adds**: FR-001\n\n### Capability: `platform`\n\n- **Adds**: FR-002';
  const frs = [['FR-001', 'adds a flag'], ['FR-002', 'adds a gate']];

  // @traces 845-FR-001
  it('reports no delta-adds-existing in any of its capabilities', () => {
    const findings = validate(spec({ head: '**Status**: Archived (2026-10-07)', frs, delta }), two);
    assert.deepEqual(rulesOf(findings), []);
  });

  // @traces 845-FR-002
  it('reports one delta-adds-existing per capability when the feature is not archived', () => {
    const findings = validate(spec({ head: '**Status**: Draft', frs, delta }), two);
    assert.deepEqual(rulesOf(findings), ['delta-adds-existing', 'delta-adds-existing']);
  });

  // @traces 845-FR-002
  it('still reports an unknown capability next to a skipped one for an archived feature', () => {
    const d = `${delta}\n\n### Capability: \`ghost\`\n\n- **Adds**: FR-003`;
    const findings = validate(spec({ head: '**Status**: Archived', frs: [...frs, ['FR-003', 'x']], delta: d }), two);
    assert.deepEqual(rulesOf(findings), ['delta-unknown-capability']);
  });
});

describe('every other rule still fires for an archived feature', () => {
  const archived = '**Status**: Archived (2026-10-07)';

  // @traces 845-FR-002
  it('reports a Modifies whose base is missing', () => {
    const d = `${DELTA}\n- **Modifies**: \`${T('001', '099')}\` -> FR-002`;
    const findings = validate(spec({ head: archived, frs: [['FR-001', 'a'], ['FR-002', 'b']], delta: d }));
    assert.ok(rulesOf(findings).includes('delta-base-missing'));
    assert.equal(existing(findings), undefined);
  });

  // @traces 845-FR-002
  it('reports a Modifies whose base is retired', () => {
    const d = `${DELTA}\n- **Modifies**: \`${T('001', '004')}\` -> FR-002`;
    const caps = [['cli-tasks', [[T('002', '001'), 'adds a flag']], [[T('001', '004'), 'removed']]]];
    const findings = validate(spec({ head: archived, frs: [['FR-001', 'a'], ['FR-002', 'b']], delta: d }), caps);
    assert.ok(rulesOf(findings).includes('delta-base-retired'));
  });

  // @traces 845-FR-002
  it('reports a malformed Modifies', () => {
    const d = `${DELTA}\n- **Modifies**: \`${T('001', '004')}\``;
    const caps = [['cli-tasks', [[T('002', '001'), 'adds a flag'], [T('001', '004'), 'lists']]]];
    const findings = validate(spec({ head: archived, delta: d }), caps);
    assert.ok(rulesOf(findings).includes('delta-modifies-malformed'));
  });

  // @traces 845-FR-002
  it('reports an Adds that the spec never declared', () => {
    const d = '### Capability: `cli-tasks`\n\n- **Adds**: FR-001, FR-077';
    assert.deepEqual(rulesOf(validate(spec({ head: archived, delta: d }))), ['delta-adds-undeclared']);
  });

  // @traces 845-FR-002
  it('warns about a declared requirement assigned to nothing', () => {
    const findings = validate(spec({ head: archived, frs: [['FR-001', 'a'], ['FR-009', 'b']] }));
    assert.equal(findings.find((f) => f.rule === 'delta-unassigned')?.level, 'WARN');
  });

  // @traces 845-FR-002
  it('reports a missing Spec Delta section', () => {
    assert.deepEqual(rulesOf(validate(spec({ head: archived, delta: '' }))), ['delta-missing']);
  });

  // @traces 845-FR-002
  it('still reports the unknown capability when no capability file exists', () => {
    const findings = validate(spec({ head: archived }), []);
    assert.deepEqual(rulesOf(findings), ['delta-unknown-capability']);
  });
});

describe('an archived feature whose Modifies and Removes are already merged', () => {
  const head = '**Status**: Archived (2026-10-08)';
  const frs = [['FR-001', 'adds a flag'], ['FR-002', 'replaces the old flag']];
  const delta =
    '### Capability: `cli-tasks`\n\n- **Adds**: FR-001\n- **Modifies**: `001-FR-004` → `FR-002`\n- **Removes**: `001-FR-005`';
  const caps = (retired) => [
    ['cli-tasks', [[T('002', '001'), 'adds a flag'], [T('002', '002'), 'replaces the old flag']], retired],
  ];

  // @traces 845-FR-001
  it('accepts the bases its own archive retired', () => {
    const findings = validate(
      spec({ delta, frs, head }),
      caps([
        [T('001', '004'), `superseded by \`${T('002', '002')}\` (2026-10-08)`],
        [T('001', '005'), 'removed by 002-fixture (2026-10-08)'],
      ]),
    );
    assert.deepEqual(rulesOf(findings), []);
  });

  // @traces 845-FR-001
  it('still refuses a base another feature retired', () => {
    const findings = validate(
      spec({ delta, frs, head }),
      caps([
        [T('001', '004'), `superseded by \`${T('003', '001')}\` (2026-10-08)`],
        [T('001', '005'), 'removed by 003-other (2026-10-08)'],
      ]),
    );
    assert.deepEqual(rulesOf(findings), ['delta-base-retired', 'delta-base-retired']);
  });

  // @traces 845-FR-001
  it('still refuses a retired base while the feature is not archived', () => {
    const findings = validate(
      spec({ delta, frs, head: '**Status**: Draft' }),
      caps([
        [T('001', '004'), `superseded by \`${T('002', '002')}\` (2026-10-08)`],
        [T('001', '005'), 'removed by 002-fixture (2026-10-08)'],
      ]),
    );
    assert.ok(rulesOf(findings).includes('delta-base-retired'));
  });
});

const fixtureFeature = (dir) => ({ dir: join(dir, 'specs', '002-fixture'), name: '002-fixture', num: '002' });
const CLI = join(import.meta.dirname, 'capabilities.mjs');
const cli = (dir, args) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

// @traces 1358-FR-011
describe('two Modifies replaced by the same requirement', () => {
  it('writes the replacement once, in the first base\'s place, and tombstones both bases', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', [
        [T('001', '001'), 'first'],
        [T('001', '002'), 'second'],
        [T('001', '003'), 'third'],
      ]),
      'specs/002-fixture/spec.md': spec({
        frs: [['FR-001', 'first and third, together']],
        delta: '### Capability: `cli-tasks`\n\n- **Modifies**: `' + T('001', '001') + '` → `FR-001`, `' + T('001', '003') + '` → `FR-001`',
      }),
    });
    try {
      const [plan] = planMerge(dir, fixtureFeature(dir));
      const headings = plan.text.match(/^### .*$/gm);
      assert.deepEqual(headings, [`### ${T('002', '001')} — first and third, together`, `### ${T('001', '002')} — second`]);
      const parsed = parseCapability(plan.text);
      assert.match(parsed.retired.get(T('001', '001')), new RegExp(`superseded by \`${T('002', '001')}\``));
      assert.match(parsed.retired.get(T('001', '003')), new RegExp(`superseded by \`${T('002', '001')}\``));
      assert.equal(cli(dir, ['merge', 'specs/002-fixture', '--apply']).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// @traces 1358-FR-012
describe('merge --apply checks the planned file against its delta', () => {
  const before = capability('cli-tasks', [
    [T('001', '004'), 'lists tasks'],
    [T('001', '009'), 'creates the data directory'],
  ]);
  const cap = { text: before };
  const section = {
    capability: 'cli-tasks',
    adds: ['FR-001'],
    modifies: [{ base: T('001', '004'), by: 'FR-006' }],
    removes: [{ base: T('001', '009'), why: '' }],
  };
  const head = (token, text = 'x') => `### ${token} — ${text}\n\n_From 002-fixture._\n`;
  const tomb = (token) => `- \`${token}\` — retired (2026-10-22)`;
  // A planned capability built by hand: the headings and tombstones each case wants.
  const planned = (headings, retired) =>
    ['---', 'capability: cli-tasks', 'updated: 2026-10-22', 'features:', '---', '', '# Capability: cli-tasks', '', '## Requirements', '',
      ...headings.map((t) => head(t)), '## Retired', '', ...retired.map(tomb), ''].join('\n');
  const good = [[T('002', '006'), T('002', '001')], [T('001', '004'), T('001', '009')]];
  const failures = (headings, retired) => checkMerge({ capability: 'cli-tasks', text: planned(headings, retired) }, cap, section, '002');

  it('passes a planned file that matches the delta', () => {
    assert.deepEqual(failures(...good), []);
  });

  for (const [label, headings, retired, pattern] of [
    ['an Adds token missing', [T('002', '006')], good[1], new RegExp(`${T('002', '001')}.*0`)],
    ['an Adds token twice', [T('002', '006'), T('002', '001'), T('002', '001')], good[1], new RegExp(`${T('002', '001')}.*2`)],
    ['a base still a heading', [T('001', '004'), T('002', '006'), T('002', '001')], good[1], new RegExp(T('001', '004'))],
    ['a tombstone missing', good[0], [T('001', '004')], /tombstone/],
    ['the heading count off', [...good[0], T('003', '001')], good[1], /heading/],
    ['a token among both headings and retired', good[0], [...good[1], T('002', '001')], new RegExp(`${T('002', '001')}.*twice`)],
  ]) {
    it(`reports ${label}`, () => {
      const found = failures(headings, retired);
      assert.ok(found.length > 0, label);
      assert.ok(found.some((f) => pattern.test(f)), found.join('\n'));
    });
  }

  it('refuses a capability already holding a requirement twice: prints the failure, exits 1, writes nothing', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', [[T('001', '004'), 'lists tasks'], [T('001', '004'), 'again']]),
      '.specify/capabilities/other.md': capability('other', [[T('001', '005'), 'other']]),
      'specs/002-fixture/spec.md': spec({
        frs: [['FR-001', 'a flag'], ['FR-006', 'a column']],
        delta: '### Capability: `other`\n\n- **Adds**: FR-001\n\n### Capability: `cli-tasks`\n\n- **Modifies**: `' + T('001', '004') + '` → `FR-006`',
      }),
    });
    const files = ['cli-tasks', 'other'].map((c) => join(dir, '.specify', 'capabilities', `${c}.md`));
    const was = files.map((f) => readFileSync(f, 'utf8'));
    try {
      const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, new RegExp(T('001', '004')));
      assert.deepEqual(files.map((f) => readFileSync(f, 'utf8')), was, 'no file is written, not even the capability that checked clean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges beside a duplicate the capability already held, which is not this merge\'s', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', [[T('001', '004'), 'lists tasks'], [T('001', '004'), 'again']]),
      'specs/002-fixture/spec.md': spec(),
    });
    try {
      const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to add a requirement the capability already retired', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', [], [[T('002', '001'), 'removed by 002-fixture (2026-01-01)']]),
      'specs/002-fixture/spec.md': spec(),
    });
    const file = join(dir, '.specify', 'capabilities', 'cli-tasks.md');
    const was = readFileSync(file, 'utf8');
    try {
      const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /twice/);
      assert.equal(readFileSync(file, 'utf8'), was);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges a lettered requirement end to end', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', [[T('001', '004'), 'lists tasks']]),
      'specs/002-fixture/spec.md': spec({ frs: [['FR-004a', 'a lettered one']], delta: '### Capability: `cli-tasks`\n\n- **Adds**: FR-004a' }),
    });
    try {
      const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const text = readFileSync(join(dir, '.specify', 'capabilities', 'cli-tasks.md'), 'utf8');
      assert.match(text, new RegExp(`^### ${T('002', '004a')} — a lettered one$`, 'm'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
