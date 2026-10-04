import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  declaredRequirements,
  loadCapabilities,
  parseCapability,
  parseDelta,
  planMerge,
  retiredTokens,
  validateFeature,
} from './capabilities.mjs';

const root = join(import.meta.dirname, '..', '..');

// Never written literally: `scripts/trace-matrix.mjs` scans every test file for
// `NNN-FR-XXX` strings, so a token spelled out here would be credited as
// coverage for a requirement this file does not cover, or reported as an orphan
// and block the commit. Assembling them at runtime is the same guard the other
// matrix fixtures use.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;
const B = (feature, n) => `\`${T(feature, n)}\``;

// Every case builds a throwaway repository: a capability file, a feature spec,
// and nothing else. The functions under test read a repo path, so a fixture is
// the only honest way to exercise them without touching this one.
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-cap-'));
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dir;
}

const capability = (slug, { requirements = [], retired = [], features = [] } = {}) =>
  [
    '---',
    `capability: ${slug}`,
    'updated: 2026-01-01',
    'features:',
    ...features.map((f) => `  - ${f}`),
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

const spec = (frs, delta) =>
  [
    '# Feature Specification: Fixture',
    '',
    '## Requirements',
    '',
    ...frs.map(([id, text]) => `- **${id}**: ${text}`),
    '',
    ...(delta ? ['## Spec Delta', '', delta, ''] : []),
    '## Success Criteria',
    '',
    '- SC-001: it works',
    '',
  ].join('\n');

const feature = (dir, name = '002-fixture') => ({ dir: join(dir, 'specs', name), name, num: name.slice(0, 3) });

const rules = (findings) => findings.map((f) => f.rule).sort();

describe('reading a living capability spec', () => {
  it('reads requirements from headings and retirements from the tombstone list', () => {
    const parsed = parseCapability(
      capability('cli-tasks', {
        features: ['001-x'],
        requirements: [[T('001', '001'), 'adds a task']],
        retired: [[T('001', '009'), 'removed by 002-x (2026-01-02)']],
      }),
    );
    assert.equal(parsed.slug, 'cli-tasks');
    assert.deepEqual(parsed.features, ['001-x']);
    assert.deepEqual([...parsed.requirements.keys()], [T('001', '001')]);
    assert.equal(parsed.requirements.get(T('001', '001')), 'adds a task');
    assert.deepEqual([...parsed.retired.keys()], [T('001', '009')]);
  });

  it('ignores a requirement token that only appears in prose', () => {
    // The whole point of reading headings: a capability that EXPLAINS why it
    // dropped a requirement must not be read as still holding it.
    const parsed = parseCapability(
      ['---', 'capability: c', 'updated: 2026-01-01', 'features:', '---', '', '## Requirements', '',
        'This capability replaced ' + T('001', '004') + ' long ago; see the note on ' + T('001', '005') + '.', ''].join('\n'),
    );
    assert.equal(parsed.requirements.size, 0);
  });

  it('collects every capability on disk and every token any of them retired', () => {
    const dir = fixture({
      '.specify/capabilities/a.md': capability('a', { retired: [[T('001', '001'), 'gone']] }),
      '.specify/capabilities/b.md': capability('b', { retired: [[T('003', '007'), 'gone']] }),
      '.specify/capabilities/notes.txt': 'not a capability',
    });
    assert.deepEqual([...loadCapabilities(dir).keys()], ['a', 'b']);
    assert.deepEqual([...retiredTokens(dir)].sort(), [T('001', '001'), T('003', '007')]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('reading a feature delta', () => {
  it('expands a range, keeps singletons, and drops "none"', () => {
    const [section] = parseDelta(
      ['## Spec Delta', '', '### Capability: `cli-tasks`', '',
        '- **Adds**: FR-001–FR-004, FR-009', '- **Modifies**: none', '- **Removes**: none'].join('\n'),
    );
    assert.deepEqual(section.adds, ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-009']);
    assert.deepEqual(section.modifies, []);
    assert.deepEqual(section.removes, []);
  });

  it('reads a modify as a base and its replacement, and a remove with its reason', () => {
    const [section] = parseDelta(
      ['## Spec Delta', '', '### Capability: `c`', '',
        '- **Modifies**: `' + T('001', '004') + '` → `FR-006`', '- **Removes**: `' + T('001', '009') + '` — the flag is gone'].join('\n'),
    );
    assert.deepEqual(section.modifies, [{ base: T('001', '004'), by: 'FR-006' }]);
    assert.deepEqual(section.removes, [{ base: T('001', '009'), why: 'the flag is gone' }]);
  });

  it('carries one delta per capability when a feature spans two', () => {
    const sections = parseDelta(
      ['## Spec Delta', '', '### Capability: `a`', '', '- **Adds**: FR-001', '',
        '### Capability: `b`', '', '- **Adds**: FR-002'].join('\n'),
    );
    assert.deepEqual(sections.map((s) => s.capability), ['a', 'b']);
    assert.deepEqual(sections[1].adds, ['FR-002']);
  });

  it('stops at the next top-level section', () => {
    const [section] = parseDelta(
      ['## Spec Delta', '', '### Capability: `a`', '', '- **Adds**: FR-001', '',
        '## Success Criteria', '', '- **Adds**: FR-999'].join('\n'),
    );
    assert.deepEqual(section.adds, ['FR-001'], 'a list item after the block ends must not be read as a delta');
  });

  it('returns nothing when the spec has no delta block at all', () => {
    assert.deepEqual(parseDelta('# Spec\n\n- **FR-001**: a thing\n'), []);
  });

  it('reads declared requirements the way the rest of the harness does', () => {
    const declared = declaredRequirements('- **FR-001**: bolded\n- FR-002: plain\n  mentions FR-003 in prose\n');
    assert.deepEqual([...declared.keys()], ['FR-001', 'FR-002']);
    assert.equal(declared.get('FR-001'), 'bolded');
  });

  it('reads a requirement wrapped over indented lines as one text', () => {
    const declared = declaredRequirements(
      [
        '- **FR-001**: The list of languages MUST be defined once, as Romanian',
        '  (`ro`) and English (`en`); Romanian is the',
        '  default.',
        '- **FR-002**: one line',
        '  - a nested bullet is not part of it',
        '- **FR-003**: ends at a blank line',
        '',
        '  indented prose after the blank is not part of it',
        '- **FR-004**: ends at an unindented line',
        'Prose.',
      ].join('\n'),
    );
    assert.equal(declared.get('FR-001'), 'The list of languages MUST be defined once, as Romanian (`ro`) and English (`en`); Romanian is the default.');
    assert.equal(declared.get('FR-002'), 'one line');
    assert.equal(declared.get('FR-003'), 'ends at a blank line');
    assert.equal(declared.get('FR-004'), 'ends at an unindented line');
  });
});

describe('validating a delta before it can corrupt a capability', () => {
  const build = (delta, capOptions = {}) =>
    fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', {
        requirements: [[T('001', '004'), 'lists tasks']],
        ...capOptions,
      }),
      'specs/002-fixture/spec.md': spec(
        [['FR-001', 'adds a flag'], ['FR-006', 'lists tasks with a column']],
        delta,
      ),
    });

  const run = (delta, capOptions) => {
    const dir = build(delta, capOptions);
    try {
      return validateFeature(dir, feature(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('passes a delta whose every base exists', () => {
    const findings = run('### Capability: `cli-tasks`\n\n- **Adds**: FR-001\n- **Modifies**: `' + T('001', '004') + '` → `FR-006`');
    assert.deepEqual(findings, []);
  });

  it('catches a Modifies whose base is not in the capability — the check OpenSpec defers to archive time', () => {
    const findings = run('### Capability: `cli-tasks`\n\n- **Adds**: FR-001, FR-006\n- **Modifies**: `' + T('001', '099') + '` → `FR-006`');
    assert.ok(rules(findings).includes('delta-base-missing'));
    assert.match(findings.find((f) => f.rule === 'delta-base-missing').message, new RegExp(T('001', '099')));
    assert.equal(findings.find((f) => f.rule === 'delta-base-missing').level, 'ERROR');
  });

  it('catches a Removes whose base is not in the capability', () => {
    const findings = run('### Capability: `cli-tasks`\n\n- **Adds**: FR-001, FR-006\n- **Removes**: `' + T('001', '099') + '` — gone');
    assert.ok(rules(findings).includes('delta-base-missing'));
  });

  it('distinguishes a base that was already retired from one that never existed', () => {
    const findings = run(
      '### Capability: `cli-tasks`\n\n- **Adds**: FR-001, FR-006\n- **Removes**: `' + T('001', '009') + '` — gone',
      { retired: [[T('001', '009'), 'removed earlier']] },
    );
    assert.ok(rules(findings).includes('delta-base-retired'));
    assert.match(findings.find((f) => f.rule === 'delta-base-retired').message, /already retired/);
  });

  it('rejects a capability the repository does not have', () => {
    const findings = run('### Capability: `invented`\n\n- **Adds**: FR-001, FR-006');
    assert.deepEqual(rules(findings), ['delta-unknown-capability']);
  });

  it('rejects an Adds naming an id the spec never declared', () => {
    const findings = run('### Capability: `cli-tasks`\n\n- **Adds**: FR-001, FR-006, FR-077');
    assert.ok(rules(findings).includes('delta-adds-undeclared'));
  });

  it('rejects an Adds for a requirement the capability already holds — that is a Modifies', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', { requirements: [[T('002', '001'), 'adds a flag']] }),
      'specs/002-fixture/spec.md': spec([['FR-001', 'adds a flag']], '### Capability: `cli-tasks`\n\n- **Adds**: FR-001'),
    });
    try {
      assert.ok(rules(validateFeature(dir, feature(dir))).includes('delta-adds-existing'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a Modifies with no replacement', () => {
    const findings = run('### Capability: `cli-tasks`\n\n- **Adds**: FR-001, FR-006\n- **Modifies**: `' + T('001', '004') + '`');
    assert.ok(rules(findings).includes('delta-modifies-malformed'));
  });

  it('warns about a declared requirement the delta assigns to nothing', () => {
    const findings = run('### Capability: `cli-tasks`\n\n- **Adds**: FR-001');
    const unassigned = findings.find((f) => f.rule === 'delta-unassigned');
    assert.equal(unassigned.level, 'WARN');
    assert.match(unassigned.message, /FR-006/);
  });

  it('warns — never errors — when a spec with requirements carries no delta at all', () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks'),
      'specs/002-fixture/spec.md': spec([['FR-001', 'a thing']], null),
    });
    try {
      const findings = validateFeature(dir, feature(dir));
      assert.deepEqual(rules(findings), ['delta-missing']);
      assert.equal(findings[0].level, 'WARN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says nothing about a spec that declares no requirements', () => {
    const dir = fixture({ 'specs/002-fixture/spec.md': '# Spec\n\nNo requirements yet.\n' });
    try {
      assert.deepEqual(validateFeature(dir, feature(dir)), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('merging a delta into the living capability', () => {
  const build = () =>
    fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', {
        features: ['001-x'],
        requirements: [
          [T('001', '004'), 'lists tasks'],
          [T('001', '009'), 'creates the data directory'],
        ],
      }),
      'specs/002-fixture/spec.md': spec(
        [['FR-001', 'accepts a priority flag'], ['FR-006', 'lists tasks with a Priority column']],
        [
          '### Capability: `cli-tasks`',
          '',
          '- **Adds**: FR-001',
          '- **Modifies**: `' + T('001', '004') + '` → `FR-006`',
          '- **Removes**: `' + T('001', '009') + '` — the directory is created on demand',
        ].join('\n'),
      ),
    });

  it('adds, supersedes and retires in one plan without writing anything', () => {
    const dir = build();
    try {
      const before = readFileSync(join(dir, '.specify/capabilities/cli-tasks.md'), 'utf8');
      const [plan] = planMerge(dir, feature(dir));
      assert.deepEqual(plan.added, [T('002', '001')]);
      assert.deepEqual(plan.modified, [{ base: T('001', '004'), token: T('002', '006') }]);
      assert.deepEqual(plan.removed.map((r) => r.base), [T('001', '009')]);
      assert.equal(
        readFileSync(join(dir, '.specify/capabilities/cli-tasks.md'), 'utf8'),
        before,
        'planning must not write — a dry run that edits is not a dry run',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('produces a capability holding the new requirement, the replacement and neither original', () => {
    const dir = build();
    try {
      const [plan] = planMerge(dir, feature(dir));
      const parsed = parseCapability(plan.text);
      assert.deepEqual([...parsed.requirements.keys()].sort(), [T('002', '001'), T('002', '006')]);
      assert.equal(parsed.requirements.get(T('002', '006')), 'lists tasks with a Priority column');
      assert.deepEqual([...parsed.retired.keys()].sort(), [T('001', '004'), T('001', '009')]);
      assert.match(parsed.retired.get(T('001', '004')), new RegExp('superseded by ' + B('002', '006')));
      assert.match(parsed.retired.get(T('001', '009')), /removed by 002-fixture/);
      assert.match(parsed.retired.get(T('001', '009')), /the directory is created on demand/);
      assert.ok(parsed.features.includes('002-fixture'), 'the capability records which features built it');
      assert.ok(parsed.features.includes('001-x'), 'and keeps the ones that already did');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges a requirement wrapped over several lines with its whole text', () => {
    const dir = fixture({
      '.specify/capabilities/i18n.md': capability('i18n'),
      'specs/002-fixture/spec.md': spec(
        [['FR-001', 'Each area MUST\n  have its own Romanian file\n  and its own English file.']],
        '### Capability: `i18n`\n\n- **Adds**: FR-001',
      ),
    });
    try {
      const [plan] = planMerge(dir, feature(dir));
      assert.equal(
        parseCapability(plan.text).requirements.get(T('002', '001')),
        'Each area MUST have its own Romanian file and its own English file.',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [label, line] of [
    ['an empty inline list', 'features: []'],
    ['a bare key, as the template writes it', 'features:'],
  ]) {
    it(`records the feature in a capability whose features are ${label}`, () => {
      const dir = fixture({
        '.specify/capabilities/i18n.md': capability('i18n').replace('features:\n', `${line}\n`),
        'specs/002-fixture/spec.md': spec([['FR-001', 'switches language']], '### Capability: `i18n`\n\n- **Adds**: FR-001'),
      });
      try {
        const [plan] = planMerge(dir, feature(dir));
        assert.deepEqual(parseCapability(plan.text).features, ['002-fixture']);
        assert.match(plan.text, /^features:\n {2}- 002-fixture\n---$/m);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('keeps a superseded requirement in its original position', () => {
    // Reading order is the order the behaviour was built in. A replacement
    // appended to the end would scatter one command's rules across the file.
    const dir = build();
    try {
      const [plan] = planMerge(dir, feature(dir));
      const headings = [...plan.text.matchAll(/^### (\d{3}-FR-\d{3})/gm)].map((m) => m[1]);
      assert.deepEqual(headings, [T('002', '006'), T('002', '001')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the capabilities command', () => {
  const cli = (dir, args) =>
    spawnSync(process.execPath, [join(root, '.claude', 'scripts', 'capabilities.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });

  const repo = () => {
    const dir = fixture({
      '.specify/capabilities/cli-tasks.md': capability('cli-tasks', {
        requirements: [[T('001', '004'), 'lists tasks']],
        retired: [[T('001', '002'), 'removed by 002-fixture (2026-01-02)']],
      }),
      'specs/002-fixture/spec.md': spec(
        [['FR-006', 'lists tasks with a Priority column']],
        '### Capability: `cli-tasks`\n\n- **Modifies**: `' + T('001', '004') + '` → `FR-006`',
      ),
    });
    return dir;
  };

  it('lists every capability with its counts', () => {
    const dir = repo();
    try {
      const { stdout, status } = cli(dir, ['list']);
      assert.equal(status, 0);
      assert.match(stdout, /cli-tasks\s+1 requirement\(s\), 1 retired/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints one capability in full and fails on a name it does not have', () => {
    const dir = repo();
    try {
      assert.match(cli(dir, ['show', 'cli-tasks']).stdout, new RegExp('### ' + T('001', '004')));
      assert.equal(cli(dir, ['show', 'nope']).status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints retired tokens as JSON for the traceability matrix to read', () => {
    const dir = repo();
    try {
      assert.deepEqual(JSON.parse(cli(dir, ['retired', '--json']).stdout), [T('001', '002')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 on a clean delta and 1 under --check on a broken one', () => {
    const dir = repo();
    try {
      assert.equal(cli(dir, ['validate', 'specs/002-fixture', '--check']).status, 0);
      writeFileSync(
        join(dir, 'specs/002-fixture/spec.md'),
        spec([['FR-006', 'x']], '### Capability: `cli-tasks`\n\n- **Modifies**: `' + T('001', '077') + '` → `FR-006`'),
      );
      const broken = cli(dir, ['validate', 'specs/002-fixture', '--check']);
      assert.equal(broken.status, 1);
      assert.match(broken.stdout, /delta-base-missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to merge a delta that does not validate', () => {
    const dir = repo();
    try {
      writeFileSync(
        join(dir, 'specs/002-fixture/spec.md'),
        spec([['FR-006', 'x']], '### Capability: `cli-tasks`\n\n- **Removes**: `' + T('001', '077') + '` — gone'),
      );
      const result = cli(dir, ['merge', 'specs/002-fixture', '--apply']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /delta error/);
      assert.match(
        readFileSync(join(dir, '.specify/capabilities/cli-tasks.md'), 'utf8'),
        new RegExp('### ' + T('001', '004')),
        'a refused merge must leave the capability exactly as it was',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes only under --apply', () => {
    const dir = repo();
    const file = join(dir, '.specify/capabilities/cli-tasks.md');
    try {
      const before = readFileSync(file, 'utf8');
      assert.match(cli(dir, ['merge', 'specs/002-fixture']).stdout, /Dry run/);
      assert.equal(readFileSync(file, 'utf8'), before);
      assert.equal(cli(dir, ['merge', 'specs/002-fixture', '--apply']).status, 0);
      assert.notEqual(readFileSync(file, 'utf8'), before);
      assert.match(readFileSync(file, 'utf8'), new RegExp('### ' + T('002', '006')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
