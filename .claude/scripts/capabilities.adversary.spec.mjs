import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkMerge, declaredRequirements, parseCapability, parseDelta, planMerge, validateFeature } from './capabilities.mjs';

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

// Cases first written as the hardening pass's own file, kept with their helpers.
describe('hardening: lettered ids, wrapped lists, odd deltas and the merge command', () => {
  // Requirement tokens are assembled at runtime so the trace matrix does not scan them.
  const T = (feature, n) => `${feature}${'-FR-'}${n}`;
  const CLI = join(import.meta.dirname, 'capabilities.mjs');

  function fixture(files) {
    const dir = mkdtempSync(join(tmpdir(), 'cap-harden-'));
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
      ...requirements.flatMap(([token, text]) => [`### ${token} — ${text}`, '', '_From x._', '']),
      '## Retired',
      '',
      ...retired.map(([token, why]) => `- \`${token}\` — ${why}`),
      '',
    ].join('\n');

  const spec = (frs, delta, head = '') =>
    [
      '# Feature Specification: Fixture',
      head,
      '## Requirements',
      '',
      ...frs,
      '',
      ...(delta === null ? [] : ['## Spec Delta', '', delta, '']),
      '## Success Criteria',
      '',
      '- SC-001: it works',
      '',
    ].join('\n');

  const feature = (dir, name = '002-fixture') => ({ dir: join(dir, 'specs', name), name, num: name.match(/^(\d+)-/)[1] });
  const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  const withDir = (files, body) => {
    const dir = fixture(files);
    try {
      return body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const rules = (findings) => findings.map((f) => f.rule).sort();
  const fr = (id, text = 'does a thing') => `- **${id}**: ${text}`;

  // @traces 1358-FR-009
  describe('lettered ids in the delta and in capabilities', () => {
    it('reads a lettered id in Adds next to a plain one', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-004a, FR-005, FR-006b'));
      assert.deepEqual(s.adds, ['FR-004a', 'FR-005', 'FR-006b']);
    });

    it('does not expand a range whose end carries a letter into the numbers between', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-001–FR-004a'));
      assert.ok(!s.adds.includes('FR-002') && !s.adds.includes('FR-003'), JSON.stringify(s.adds));
    });

    it('still expands an unlettered range', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-001–FR-004'));
      assert.deepEqual(s.adds, ['FR-001', 'FR-002', 'FR-003', 'FR-004']);
    });

    it('reads lettered bases and replacements in Modifies and lettered bases in Removes', () => {
      const [s] = parseDelta(
        spec([], '### Capability: `a`\n\n- **Modifies**: `' + T('1018', '004a') + '` → `FR-005b`\n- **Removes**: `' + T('1018', '009z') + '` — gone'),
      );
      assert.deepEqual(s.modifies, [{ base: T('1018', '004a'), by: 'FR-005b' }]);
      assert.deepEqual(s.removes, [{ base: T('1018', '009z'), why: 'gone' }]);
    });

    it('refuses an uppercase letter or two letters on a requirement number', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-004A, FR-005ab'));
      assert.ok(!s.adds.includes('FR-004A') && !s.adds.includes('FR-005ab'), JSON.stringify(s.adds));
    });

    it('declares FR-004 and FR-004a as two requirements', () => {
      const declared = declaredRequirements(spec([fr('FR-004', 'plain'), fr('FR-004a', 'lettered')], null));
      assert.deepEqual([...declared.keys()], ['FR-004', 'FR-004a']);
      assert.equal(declared.get('FR-004a'), 'lettered');
    });

    it('reads a feature number longer than three digits whole in headings and tombstones', () => {
      const cap = parseCapability(capability('a', [[T('12345', '001'), 'x'], [T('1358', '004a'), 'y']], [[T('99999', '002b'), 'retired']]));
      assert.deepEqual(cap.headings, [T('12345', '001'), T('1358', '004a')]);
      assert.deepEqual(cap.tombstones, [T('99999', '002b')]);
    });

    it('modifies the plain base without touching the lettered sibling heading', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', [[T('001', '004'), 'plain'], [T('001', '004a'), 'lettered']]),
          'specs/002-fixture/spec.md': spec([fr('FR-001', 'new')], '### Capability: `a`\n\n- **Modifies**: `' + T('001', '004') + '` → `FR-001`'),
        },
        (dir) => {
          const [plan] = planMerge(dir, feature(dir));
          assert.deepEqual(parseCapability(plan.text).headings, [T('002', '001'), T('001', '004a')]);
        },
      );
    });

    it('merges a lettered Modifies replacement of a lettered base end to end', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', [[T('001', '004a'), 'old']]),
          'specs/002-fixture/spec.md': spec([fr('FR-005b', 'new')], '### Capability: `a`\n\n- **Modifies**: `' + T('001', '004a') + '` → `FR-005b`'),
        },
        (dir) => {
          const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
          assert.equal(r.status, 0, r.stderr);
          const cap = parseCapability(readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'));
          assert.deepEqual(cap.headings, [T('002', '005b')]);
          assert.deepEqual(cap.tombstones, [T('001', '004a')]);
        },
      );
    });

    it('merges under a four-digit feature number', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', []),
          'specs/1358-fixture/spec.md': spec([fr('FR-001')], '### Capability: `a`\n\n- **Adds**: FR-001'),
        },
        (dir) => {
          const r = cli(dir, ['merge', 'specs/1358-fixture', '--apply']);
          assert.equal(r.status, 0, r.stderr);
          assert.deepEqual(parseCapability(readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8')).headings, [T('1358', '001')]);
        },
      );
    });
  });

  // @traces 1358-FR-010
  describe('text and lists wrapped over indented lines', () => {
    it('reads a requirement continued on a nested bullet as one text', () => {
      const declared = declaredRequirements(spec([fr('FR-001', 'first part'), '  - nested part', '    deeper line', fr('FR-002', 'next')], null));
      assert.equal(declared.get('FR-001'), 'first part nested part deeper line');
      assert.equal(declared.get('FR-002'), 'next');
    });

    it('ends a requirement at a blank line', () => {
      const declared = declaredRequirements(spec([fr('FR-001', 'first'), '', '  indented after a blank'], null));
      assert.equal(declared.get('FR-001'), 'first');
    });

    it('does not fold a sibling bullet at the same indent into the requirement', () => {
      const declared = declaredRequirements(spec([fr('FR-001', 'first'), '- unrelated bullet'], null));
      assert.equal(declared.get('FR-001'), 'first');
    });

    it('reads an Adds list wrapped over several indented lines as one list', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-001, FR-002,\n  FR-003,\n    FR-004a'));
      assert.deepEqual(s.adds, ['FR-001', 'FR-002', 'FR-003', 'FR-004a']);
    });

    it('reads a Modifies entry whose arrow sits on the continuation line', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Modifies**: `' + T('001', '001') + '`\n  → `FR-002`'));
      assert.deepEqual(s.modifies, [{ base: T('001', '001'), by: 'FR-002' }]);
    });

    it('keeps a wrapped list from swallowing the next list', () => {
      const [s] = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-001,\n  FR-002\n- **Removes**: `' + T('001', '009') + '` — gone'));
      assert.deepEqual(s.adds, ['FR-001', 'FR-002']);
      assert.deepEqual(s.removes, [{ base: T('001', '009'), why: 'gone' }]);
    });

    it('keeps a wrapped list inside its own capability section', () => {
      const sections = parseDelta(spec([], '### Capability: `a`\n\n- **Adds**: FR-001,\n  FR-002\n\n### Capability: `b`\n\n- **Adds**: FR-003'));
      assert.deepEqual(sections.map((s) => [s.capability, s.adds]), [['a', ['FR-001', 'FR-002']], ['b', ['FR-003']]]);
    });

    it('reads a wrapped list written with Windows line endings', () => {
      const text = spec([], '### Capability: `a`\n\n- **Adds**: FR-001,\n  FR-002').replace(/\n/g, '\r\n');
      const [s] = parseDelta(text);
      assert.deepEqual(s.adds.map((a) => a.trim()), ['FR-001', 'FR-002']);
    });

    it('reads a wrapped requirement and capability headings written with Windows line endings', () => {
      const declared = declaredRequirements(spec([fr('FR-001', 'first part'), '  next part'], null).replace(/\n/g, '\r\n'));
      assert.equal(declared.get('FR-001'), 'first part next part');
      const cap = parseCapability(capability('a', [[T('001', '001'), 'one']], [[T('001', '002'), 'gone']]).replace(/\n/g, '\r\n'));
      assert.deepEqual([cap.slug, cap.headings, cap.tombstones], ['a', [T('001', '001')], [T('001', '002')]]);
    });

    it('reads an indented continuation after the last list of the file', () => {
      const [s] = parseDelta('## Spec Delta\n\n### Capability: `a`\n\n- **Adds**: FR-001,\n  FR-002');
      assert.deepEqual(s.adds, ['FR-001', 'FR-002']);
    });
  });

  // @traces 1358-FR-006
  describe('validate on adds-and-modifies and all-adds', () => {
    const caps = { '.specify/capabilities/a.md': capability('a', [[T('001', '002'), 'old']]), '.specify/capabilities/b.md': capability('b', []) };
    const run = (frs, delta, extra = {}) =>
      withDir({ ...caps, ...extra, 'specs/002-fixture/spec.md': spec(frs, delta) }, (dir) => validateFeature(dir, feature(dir)));

    it('reports the clash when Adds and the Modifies replacement sit in different capability sections', () => {
      const findings = run(
        [fr('FR-003')],
        '### Capability: `b`\n\n- **Adds**: FR-003\n\n### Capability: `a`\n\n- **Modifies**: `' + T('001', '002') + '` → `FR-003`',
      );
      assert.deepEqual(rules(findings).filter((r) => r === 'delta-adds-and-modifies'), ['delta-adds-and-modifies']);
      assert.equal(findings.find((f) => f.rule === 'delta-adds-and-modifies').level, 'ERROR');
    });

    it('reports the clash once for a lettered id', () => {
      const findings = run(
        [fr('FR-003a')],
        '### Capability: `b`\n\n- **Adds**: FR-003a\n\n### Capability: `a`\n\n- **Modifies**: `' + T('001', '002') + '` → `FR-003a`',
      );
      assert.equal(findings.filter((f) => f.rule === 'delta-adds-and-modifies').length, 1);
    });

    it('does not confuse FR-003 under Adds with FR-003a as the replacement', () => {
      const findings = run(
        [fr('FR-003'), fr('FR-003a')],
        '### Capability: `b`\n\n- **Adds**: FR-003\n\n### Capability: `a`\n\n- **Modifies**: `' + T('001', '002') + '` → `FR-003a`',
      );
      assert.ok(!rules(findings).includes('delta-adds-and-modifies'), JSON.stringify(findings));
    });

    it('warns once for an Adds-only delta spread over two sections', () => {
      const findings = run([fr('FR-003'), fr('FR-004')], '### Capability: `a`\n\n- **Adds**: FR-003\n\n### Capability: `b`\n\n- **Adds**: FR-004');
      assert.equal(findings.filter((f) => f.rule === 'delta-all-adds').length, 1);
      assert.equal(findings.find((f) => f.rule === 'delta-all-adds').level, 'WARN');
    });

    it('does not warn when another section only removes', () => {
      const findings = run([fr('FR-003')], '### Capability: `b`\n\n- **Adds**: FR-003\n\n### Capability: `a`\n\n- **Removes**: `' + T('001', '002') + '` — gone');
      assert.ok(!rules(findings).includes('delta-all-adds'));
    });

    it('does not warn for a delta that names no Adds', () => {
      const findings = run([fr('FR-003')], '### Capability: `a`\n\n- **Modifies**: `' + T('001', '002') + '` → `FR-003`');
      assert.ok(!rules(findings).includes('delta-all-adds'));
    });

    it('does not warn when a Modifies sits in a section naming an unknown capability', () => {
      const findings = run([fr('FR-003')], '### Capability: `b`\n\n- **Adds**: FR-003\n\n### Capability: `ghost`\n\n- **Removes**: `' + T('001', '002') + '` — x');
      assert.ok(!rules(findings).includes('delta-all-adds'));
      assert.ok(rules(findings).includes('delta-unknown-capability'));
    });

    it('reports a capability named by two sections, whose second merge would overwrite the first', () => {
      const findings = run([fr('FR-001'), fr('FR-002')], '### Capability: `b`\n\n- **Adds**: FR-001\n\n### Capability: `b`\n\n- **Adds**: FR-002');
      assert.ok(rules(findings).includes('delta-capability-twice'), JSON.stringify(findings));
    });

    it('prints one counts line per section, in order, with zeros', () => {
      withDir(
        { ...caps, 'specs/002-fixture/spec.md': spec([fr('FR-003'), fr('FR-004')], '### Capability: `b`\n\n- **Adds**: FR-003, FR-004\n\n### Capability: `a`\n\n- **Removes**: `' + T('001', '002') + '` — x') },
        (dir) => {
          const r = cli(dir, ['validate', 'specs/002-fixture', '--check']);
          assert.equal(r.status, 0, r.stdout + r.stderr);
          const lines = r.stdout.split('\n').filter((l) => /^[\w-]+: \+\d+ ~\d+ -\d+$/.test(l));
          assert.deepEqual(lines, ['b: +2 ~0 -0', 'a: +0 ~0 -1']);
        },
      );
    });

    it('prints a counts line for a section naming an unknown capability and exits 1 under --check', () => {
      withDir({ ...caps, 'specs/002-fixture/spec.md': spec([fr('FR-003')], '### Capability: `ghost`\n\n- **Adds**: FR-003') }, (dir) => {
        const r = cli(dir, ['validate', 'specs/002-fixture', '--check']);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /^ghost: \+1 ~0 -0$/m);
      });
    });

    it('exits 1 under --check for adds-and-modifies and 0 without it', () => {
      const files = {
        ...caps,
        'specs/002-fixture/spec.md': spec([fr('FR-003')], '### Capability: `a`\n\n- **Adds**: FR-003\n- **Modifies**: `' + T('001', '002') + '` → `FR-003`'),
      };
      withDir(files, (dir) => {
        assert.equal(cli(dir, ['validate', 'specs/002-fixture', '--check']).status, 1);
        assert.equal(cli(dir, ['validate', 'specs/002-fixture']).status, 0);
      });
    });

    it('prints no counts line when the spec has no delta', () => {
      withDir({ ...caps, 'specs/002-fixture/spec.md': spec([fr('FR-003')], null) }, (dir) => {
        const r = cli(dir, ['validate', 'specs/002-fixture', '--check']);
        assert.equal(r.status, 0);
        assert.doesNotMatch(r.stdout, /: \+\d+ ~\d+ -\d+/);
      });
    });
  });

  // @traces 1358-FR-011
  describe('a replacement shared across sections or placed oddly', () => {
    it('writes a shared replacement once in each capability when two sections name it', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', [[T('001', '001'), 'one']]),
          '.specify/capabilities/b.md': capability('b', [[T('001', '002'), 'two']]),
          'specs/002-fixture/spec.md': spec(
            [fr('FR-001', 'merged')],
            '### Capability: `a`\n\n- **Modifies**: `' + T('001', '001') + '` → `FR-001`\n\n### Capability: `b`\n\n- **Modifies**: `' + T('001', '002') + '` → `FR-001`',
          ),
        },
        (dir) => {
          const plans = planMerge(dir, feature(dir));
          assert.equal(plans.length, 2);
          for (const plan of plans) assert.deepEqual(parseCapability(plan.text).headings, [T('002', '001')]);
        },
      );
    });

    it('names the replacement in both tombstones when three bases share it', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two'], [T('001', '003'), 'three'], [T('001', '004'), 'keep']]),
          'specs/002-fixture/spec.md': spec(
            [fr('FR-001', 'merged')],
            '### Capability: `a`\n\n- **Modifies**: `' + T('001', '003') + '` → `FR-001`, `' + T('001', '001') + '` → `FR-001`, `' + T('001', '002') + '` → `FR-001`',
          ),
        },
        (dir) => {
          const [plan] = planMerge(dir, feature(dir));
          const cap = parseCapability(plan.text);
          assert.deepEqual(cap.headings, [T('002', '001'), T('001', '004')]);
          assert.deepEqual([...cap.retired.keys()].sort(), [T('001', '001'), T('001', '002'), T('001', '003')]);
          assert.equal(checkMerge(plan, { text: capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two'], [T('001', '003'), 'three'], [T('001', '004'), 'keep']]) }, parseDelta(readFileSync(join(dir, 'specs/002-fixture/spec.md'), 'utf8'))[0], '002').length, 0);
        },
      );
    });

    it('places the replacement where the first base the delta lists stood', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two'], [T('001', '003'), 'three']]),
          'specs/002-fixture/spec.md': spec(
            [fr('FR-001', 'merged')],
            '### Capability: `a`\n\n- **Modifies**: `' + T('001', '003') + '` → `FR-001`, `' + T('001', '001') + '` → `FR-001`',
          ),
        },
        (dir) => {
          const [plan] = planMerge(dir, feature(dir));
          assert.deepEqual(parseCapability(plan.text).headings, [T('001', '002'), T('002', '001')]);
        },
      );
    });
  });

  // @traces 1358-FR-012
  describe('the post-merge check against odd deltas', () => {
    const cap = capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two']]);

    it('passes a Removes-only plan from planMerge', () => {
      withDir(
        {
          '.specify/capabilities/a.md': cap,
          'specs/002-fixture/spec.md': spec([], '### Capability: `a`\n\n- **Removes**: `' + T('001', '002') + '` — gone'),
        },
        (dir) => {
          const [plan] = planMerge(dir, feature(dir));
          const section = parseDelta(readFileSync(join(dir, 'specs/002-fixture/spec.md'), 'utf8'))[0];
          assert.deepEqual(checkMerge(plan, { text: cap }, section, '002'), []);
          assert.deepEqual(parseCapability(plan.text).headings, [T('001', '001')]);
        },
      );
    });

    it('fails a Removes-only plan that is the unchanged file', () => {
      const section = { capability: 'a', adds: [], modifies: [], removes: [{ base: T('001', '002'), why: 'x' }] };
      const failures = checkMerge({ capability: 'a', text: cap }, { text: cap }, section, '002');
      assert.ok(failures.some((f) => f.includes(`${T('001', '002')} is still a requirement heading`)), failures.join('\n'));
      assert.ok(failures.some((f) => /tombstone/.test(f)), failures.join('\n'));
    });

    it('passes an empty delta section against an unchanged file', () => {
      const section = { capability: 'a', adds: [], modifies: [], removes: [] };
      assert.deepEqual(checkMerge({ capability: 'a', text: cap }, { text: cap }, section, '002'), []);
    });

    it('fails a plan that dropped a requirement the delta never named', () => {
      const section = { capability: 'a', adds: [], modifies: [], removes: [] };
      const failures = checkMerge({ capability: 'a', text: capability('a', [[T('001', '001'), 'one']]) }, { text: cap }, section, '002');
      assert.ok(failures.some((f) => /requirement heading\(s\), not the 2/.test(f)), failures.join('\n'));
    });

    it('fails an Adds that is both a plain and a lettered heading as if they were one token', () => {
      const section = { capability: 'a', adds: ['FR-003'], modifies: [], removes: [] };
      const plan = { capability: 'a', text: capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two'], [T('002', '003a'), 'lettered only']]) };
      const failures = checkMerge(plan, { text: cap }, section, '002');
      assert.ok(failures.some((f) => f.includes(`${T('002', '003')} is a requirement heading 0 times`)), failures.join('\n'));
    });

    it('refuses a token that appears as a heading and as a tombstone when it was absent before', () => {
      const section = { capability: 'a', adds: ['FR-003'], modifies: [], removes: [] };
      const plan = { capability: 'a', text: capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two'], [T('002', '003'), 'new']], [[T('002', '003'), 'retired']]) };
      const failures = checkMerge(plan, { text: cap }, section, '002');
      assert.ok(failures.some((f) => /appears twice/.test(f)), failures.join('\n'));
    });
  });

  // @traces 1358-FR-012
  describe('merge through the command line', () => {
    const two = (bad) => ({
      '.specify/capabilities/a.md': capability('a', [[T('001', '001'), 'one']]),
      '.specify/capabilities/b.md': capability('b', [], bad ? [[T('002', '002'), 'retired earlier']] : []),
      'specs/002-fixture/spec.md': spec([fr('FR-001', 'x'), fr('FR-002', 'y')], '### Capability: `a`\n\n- **Adds**: FR-001\n\n### Capability: `b`\n\n- **Adds**: FR-002'),
    });

    it('writes neither capability when the second one fails its check', () => {
      withDir(two(true), (dir) => {
        const before = [readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'), readFileSync(join(dir, '.specify/capabilities/b.md'), 'utf8')];
        const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /b: /);
        assert.deepEqual([readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'), readFileSync(join(dir, '.specify/capabilities/b.md'), 'utf8')], before);
      });
    });

    it('merges a capability and spec written with Windows line endings into a file with one kind of ending', () => {
      const crlf = (text) => text.replace(/\n/g, '\r\n');
      const files = {
        '.specify/capabilities/a.md': crlf(capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two']])),
        'specs/002-fixture/spec.md': crlf(spec([fr('FR-001', 'x'), fr('FR-002', 'y')], '### Capability: `a`\n\n- **Adds**: FR-001\n- **Modifies**: `' + T('001', '002') + '` → `FR-002`')),
      };
      withDir(files, (dir) => {
        const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
        assert.equal(r.status, 0, r.stderr);
        const merged = readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8');
        assert.ok(!merged.includes('\r'), JSON.stringify(merged));
        const cap = parseCapability(merged);
        assert.deepEqual(cap.headings, [T('001', '001'), T('002', '002'), T('002', '001')]);
        assert.deepEqual(cap.tombstones, [T('001', '002')]);
      });
    });

    it('writes nothing without --apply and says so', () => {
      withDir(two(false), (dir) => {
        const before = readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8');
        const r = cli(dir, ['merge', 'specs/002-fixture']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /Dry run/);
        assert.equal(readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'), before);
      });
    });

    it('refuses a second apply of the same delta and leaves the file as the first left it', () => {
      withDir(two(false), (dir) => {
        assert.equal(cli(dir, ['merge', 'specs/002-fixture', '--apply']).status, 0);
        const after = readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8');
        const again = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
        assert.equal(again.status, 1);
        assert.equal(readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'), after);
        assert.equal(parseCapability(after).headings.filter((h) => h === T('002', '001')).length, 1);
      });
    });

    it('exits 1 and writes nothing when the delta names a capability that has no file', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', []),
          'specs/002-fixture/spec.md': spec([fr('FR-001'), fr('FR-002')], '### Capability: `a`\n\n- **Adds**: FR-001\n\n### Capability: `ghost`\n\n- **Adds**: FR-002'),
        },
        (dir) => {
          const before = readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8');
          const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
          assert.equal(r.status, 1);
          assert.match(r.stderr, /ghost/);
          assert.equal(readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'), before);
        },
      );
    });

    it('applies a Removes-only delta', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', [[T('001', '001'), 'one'], [T('001', '002'), 'two']]),
          'specs/002-fixture/spec.md': spec([], '### Capability: `a`\n\n- **Removes**: `' + T('001', '002') + '` — gone'),
        },
        (dir) => {
          const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
          assert.equal(r.status, 0, r.stderr);
          const cap = parseCapability(readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8'));
          assert.deepEqual(cap.headings, [T('001', '001')]);
          assert.deepEqual(cap.tombstones, [T('001', '002')]);
        },
      );
    });

    it('applies a wrapped lettered Adds list written with a nested bullet', () => {
      withDir(
        {
          '.specify/capabilities/a.md': capability('a', []),
          'specs/002-fixture/spec.md': spec([fr('FR-001', 'one'), '  - continued text', fr('FR-001a', 'one-a'), fr('FR-002', 'two')], '### Capability: `a`\n\n- **Adds**: FR-001,\n  - FR-001a\n  - FR-002'),
        },
        (dir) => {
          const r = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
          assert.equal(r.status, 0, r.stderr);
          const text = readFileSync(join(dir, '.specify/capabilities/a.md'), 'utf8');
          assert.deepEqual(parseCapability(text).headings, [T('002', '001'), T('002', '001a'), T('002', '002')]);
          assert.match(text, new RegExp(`### ${T('002', '001')} — one continued text`));
        },
      );
    });
  });
});
