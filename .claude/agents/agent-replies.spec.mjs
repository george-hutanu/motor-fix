import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
const hasEnvelope = (text) => text.includes(ENVELOPE.join('\n'));

// The output section runs from its heading to the end of the file: the
// templates inside it carry their own `## ` headings.
const outputOf = (text) => {
  const start = text.search(/^## (Output|Output format|Report)\s*$/m);
  return start < 0 ? '' : text.slice(start);
};

// Skills whose text dispatches a general-purpose agent, or runs as one.
const DISPATCHERS = ['speckit-watch', 'speckit-auto', 'speckit-plan', 'notion-ready'];

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
