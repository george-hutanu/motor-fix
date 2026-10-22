import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The phase skills and the code reviewer carry only lanes a run here takes:
// no hook dispatch for hooks a skill does not own, no interactive rendering
// /speckit-auto answers itself, no stacks or trackers this repo does not use.
// Each cut from a stock skill is listed in its deltas record, so a spec-kit
// upgrade that brings the text back is caught here.

const claude = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(claude, path), 'utf8');
const skill = (name) => read(`skills/speckit-${name}/SKILL.md`);
const split = (name) => {
  const text = skill(name);
  const at = text.indexOf(`## Agent Execution Rules: ${name} deltas`);
  assert.ok(at >= 0, `speckit-${name} has no deltas record`);
  return { body: text.slice(0, at), record: text.slice(at) };
};

const GITHUB_REREAD = /gh issue view[^\n]*george-hutanu\/motor-fix-specs|george-hutanu\/motor-fix-specs[^\n]*gh issue view/;

// Each skill: what must be gone, what must stay, and the cuts its deltas record names.
const SKILLS = {
  clarify: {
    gone: [
      'Check for extension hooks',
      'Mandatory Post-Execution Hooks',
      'Question writing quality',
      'You can reply with the option letter',
      'AskUserQuestion',
      'Extension hooks dispatched or skipped',
    ],
    kept: ['speckit.git.commit', 'EXACTLY ONE question', '**Recommended:**', 'spec-challenger'],
    cuts: ['Pre-Execution Checks', 'Mandatory Post-Execution Hooks', 'step 5', 'Done When'],
  },
  checklist: {
    gone: ['Check for extension hooks', 'Anti-Examples', 'Post-Execution Checks'],
    kept: ['speckit.git.commit'],
    cuts: ['Pre-Execution Checks', 'Anti-Examples', 'Post-Execution Checks'],
  },
  analyze: {
    gone: ['Check for extension hooks', 'False Completion', 'Checklist Truthfulness'],
    kept: ['speckit.git.commit', 'E3. Contradiction with Organisational Context'],
    cuts: ['Pre-Execution Checks', 'E2', 'E4', 'Check for extension hooks'],
  },
  implement: {
    gone: ['Project Setup Verification', '.dockerignore', 'getJiraIssue', 'Atlassian', 'Some checklists are incomplete'],
    kept: ['Check for extension hooks (before implementation)', 'count the unchecked'],
    cuts: ['Check checklists status', 'Project Setup Verification', 'Re-read the ticket'],
  },
  converge: {
    gone: ['Check for extension hooks', 'getJiraIssue', 'Atlassian'],
    kept: [],
    cuts: ['Pre-Execution Checks', 'Re-read the ticket', 'Check for extension hooks'],
  },
};

describe('phase skills carry no dead lane', () => {
  // @traces 1361-FR-101
  // @traces 1361-FR-102
  // @traces 1361-FR-103
  // @traces 1361-FR-104
  // @traces 1361-FR-105
  // @traces 1361-FR-113
  for (const [name, { gone, kept }] of Object.entries(SKILLS)) {
    it(`speckit-${name} drops its dead lanes and keeps what runs`, () => {
      const { body } = split(name);
      for (const phrase of gone) assert.ok(!body.includes(phrase), `speckit-${name} still carries "${phrase}"`);
      for (const phrase of kept) assert.ok(body.includes(phrase), `speckit-${name} lost "${phrase}"`);
    });
  }

  // @traces 1361-FR-104
  // @traces 1361-FR-105
  it('implement and converge re-read the story on GitHub, not Jira', () => {
    for (const name of ['implement', 'converge']) assert.match(split(name).body, GITHUB_REREAD, `speckit-${name}`);
  });

  // @traces 1361-FR-110
  // @traces 1361-FR-113
  it('implement no longer defers a pre-existing bug', () => {
    assert.doesNotMatch(skill('implement'), /is not fixed here/);
  });
});

describe('every cut is a recorded project-local override', () => {
  // @traces 1361-FR-109
  for (const [name, { cuts }] of Object.entries(SKILLS)) {
    it(`speckit-${name} lists its cuts in its deltas record`, () => {
      const { record } = split(name);
      assert.match(record, /project-local addition/);
      assert.match(record, /Cut \(project-local override\)/);
      for (const cut of cuts) assert.ok(record.includes(cut), `speckit-${name} deltas record does not name "${cut}"`);
    });
  }
});

describe('the code reviewer keeps its bar without the borrowed one', () => {
  const reviewer = read('agents/code-reviewer.md');
  const rubric = reviewer.slice(reviewer.indexOf('## The rubric'), reviewer.indexOf('\n## ', reviewer.indexOf('## The rubric') + 1));
  const items = rubric.split(/\n(?=\d\. \*\*)/).slice(1);

  // @traces 1361-FR-106
  it('has no house bar from another repository', () => {
    for (const phrase of ['house bar', 'apps/scanner', 'istextorbinary', 'SCANNER_MAX_FILE_BYTES', 'node_modules/.cache']) {
      assert.ok(!reviewer.includes(phrase), `code-reviewer.md still carries "${phrase}"`);
    }
    assert.doesNotMatch(reviewer, /\bBun\b/);
  });

  // @traces 1361-FR-106
  it('moves the bounded-loop rule into item 2 and the dependency reason into item 5', () => {
    assert.equal(items.length, 6);
    assert.match(items[1], /while \(true\)/);
    assert.match(items[1], /hard iteration cap/);
    assert.match(items[4], /\.npmrc/);
  });

  // @traces 1361-FR-107
  it('keeps every severity each rubric item carried', () => {
    const severities = [['HIGH'], ['HIGH', 'CRITICAL'], ['CRITICAL'], ['HIGH'], ['MEDIUM', 'HIGH'], ['CRITICAL', 'HIGH']];
    severities.forEach((words, i) => {
      for (const word of words) assert.ok(items[i].includes(word), `rubric item ${i + 1} lost ${word}`);
    });
  });

  // @traces 1361-FR-110
  it('still routes an owner decision to a needs-confirmation question', () => {
    assert.match(reviewer, /needs-confirmation/);
  });
});

describe('the trim leaves the reviewer\'s front matter alone', () => {
  // @traces 1361-FR-108
  it('keeps every code-reviewer front-matter line but description', () => {
    const lines = read('agents/code-reviewer.md').split('\n');
    assert.deepEqual([lines[0], lines[1], lines[3], lines[4], lines[5]], [
      '---',
      'name: code-reviewer',
      'tools: Read, Grep, Glob, Bash, mcp__webstorm__analyze_calls, mcp__webstorm__search_symbol, mcp__webstorm__get_file_problems',
      'model: fable',
      '---',
    ]);
    assert.match(lines[2], /^description: /);
  });
});
