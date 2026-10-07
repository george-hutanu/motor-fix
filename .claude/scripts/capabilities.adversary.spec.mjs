import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { validateFeature } from './capabilities.mjs';

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

const rulesOf = (findings) => findings.map((f) => f.rule).sort();

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
