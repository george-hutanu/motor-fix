import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Every agent reply is re-read by its caller on each later turn, so its shape
// and length are a running cost. AGENTS.md "Agent replies" defines one
// envelope; agents cannot include files, so each definition and each dispatch
// template repeats it verbatim. This spec keeps the copies identical and
// capped.
const claudeDir = join(import.meta.dirname, '..');
const repoRoot = join(claudeDir, '..');
const read = (path) => readFileSync(path, 'utf8');

const section = (text, heading) => {
  const start = text.search(new RegExp(`^## ${heading}\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
};

const ENVELOPE = (() => {
  const block = section(read(join(repoRoot, 'AGENTS.md')), 'Agent replies').match(/```\n([\s\S]*?)\n```/)?.[1] ?? '';
  return block.split('\n').slice(0, 4);
})();

const MAX_LINES = 25;
const capOf = (text) => {
  const caps = [...text.matchAll(/at\s+most\s+(\d+)\s+lines/gi)].map((m) => Number(m[1]));
  return caps.length ? Math.max(...caps) : null;
};
// A block nested in a numbered list is indented to stay in the list.
const hasEnvelope = (text) => text.split('\n').map((line) => line.trimStart()).join('\n').includes(ENVELOPE.join('\n'));

// The output section runs from its heading to the end of the file: the
// templates inside it carry their own `## ` headings.
const outputOf = (text) => {
  const start = text.search(/^## (Output|Output format|Report)\s*$/m);
  return start < 0 ? '' : text.slice(start);
};

// Skills whose text dispatches a task-runner or general-purpose agent, or runs as one.
const DISPATCHERS = ['speckit-watch', 'speckit-auto', 'speckit-plan'];

describe('the agent reply envelope', () => {
  it('is defined once in AGENTS.md as four lines', () => {
    assert.deepEqual(
      ENVELOPE.map((line) => line.split(':')[0]),
      ['STATUS', 'PR', 'NEXT', 'FILES'],
    );
  });

  const agentsDir = join(claudeDir, 'agents');
  const agents = readdirSync(agentsDir).filter((name) => name.endsWith('.md'));

  it('finds the agent definitions', () => {
    assert.ok(agents.length > 0);
  });

  for (const name of agents) {
    it(`${name}: the reply template starts with the envelope and states a cap`, () => {
      const output = outputOf(read(join(agentsDir, name)));
      assert.ok(output, 'no Output or Report section');
      const template = output.match(/```\n([\s\S]*?)\n```/)?.[1] ?? '';
      assert.deepEqual(template.split('\n').slice(0, 4), ENVELOPE, 'template does not open with the envelope');
      const cap = capOf(output);
      assert.ok(cap !== null && cap <= MAX_LINES, `cap ${cap} is missing or above ${MAX_LINES}`);
    });
  }

  for (const skill of DISPATCHERS) {
    it(`${skill}: its dispatch requires the envelope and a cap`, () => {
      const text = read(join(claudeDir, 'skills', skill, 'SKILL.md'));
      assert.ok(hasEnvelope(text), 'the envelope is not repeated verbatim');
      const cap = capOf(text);
      assert.ok(cap !== null && cap <= MAX_LINES, `cap ${cap} is missing or above ${MAX_LINES}`);
    });
  }

  it('speckit-auto keeps its full report in auto-run.md when dispatched', () => {
    const report = section(read(join(claudeDir, 'skills', 'speckit-auto', 'SKILL.md')), 'Final Report');
    assert.match(report, /auto-run\.md/);
    assert.match(report, /envelope/i);
    assert.match(report, /at most 10 lines/);
  });
});

// @traces 1355-FR-008, 1355-FR-010
describe('the tail reads tail.md alone, and AGENTS.md stays small', () => {
  const tail = join(claudeDir, 'skills', 'speckit-auto', 'tail.md');
  const DISPATCHES = [
    [tail, /^> [\s\S]*?(?=\n\n)/m],
    [join(claudeDir, 'agents', 'task-runner.md'), /"The tail" \([^)]*\)/],
    [join(claudeDir, 'skills', 'speckit-watch', 'SKILL.md'), /^ *\| `tail` \|.*$/m],
  ];

  it.each(DISPATCHES)('%s: the tail dispatch names tail.md, not speckit-auto/SKILL.md', (file, pattern) => {
    const text = read(file).match(pattern)?.[0] ?? '';
    assert.match(text, /tail\.md/);
    assert.doesNotMatch(text, /speckit-auto\/SKILL\.md/);
  });

  it('keeps what the tail reads under 30,000 bytes, with 2 KB for the note', () => {
    const bytes = [tail, join(claudeDir, 'agents', 'task-runner.md'), join(repoRoot, '.github', 'pull_request_template.md')]
      .map((file) => statSync(file).size)
      .reduce((a, b) => a + b, 2048);
    assert.ok(bytes < 30000, `${bytes} bytes`);
  });

  it('keeps AGENTS.md under 15,000 bytes', () => {
    const bytes = statSync(join(repoRoot, 'AGENTS.md')).size;
    assert.ok(bytes < 15000, `${bytes} bytes`);
  });

  // The bullet as it stood on main at 24ecff8, before AGENTS.md was cut down.
  it('keeps the "Parallel work is watched" bullet word for word', () => {
    const bullet = read(join(repoRoot, 'AGENTS.md')).match(/^- Parallel work is watched[\s\S]*?(?=\n- )/m)?.[0] ?? '';
    const sha = createHash('sha256').update(bullet).digest('hex');
    assert.equal(sha, '6d99de84561d20ebadb6339fb984b5b589ab1a077c3c154e4a64f3f54ca88f51');
  });
});
