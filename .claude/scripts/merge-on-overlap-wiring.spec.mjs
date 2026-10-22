import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Merging main, proving flows live and the tail's pending-check finish are
// prose in the constitution and the skills. These checks keep that prose
// pointing at the one overlap test, the one proof and the one write.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\s+/g, ' ');
/** The text of a numbered step `n.` up to the next step at the same indent, or the end. */
const step = (text, n, next) => {
  const start = text.indexOf(` ${n}. `);
  assert.notEqual(start, -1, `no step ${n}`);
  const end = next === undefined ? -1 : text.indexOf(` ${next}. `, start + 3);
  return text.slice(start, end === -1 ? undefined : end);
};
const tail = read('.claude/skills/speckit-auto/tail.md');
const tailSteps = tail.slice(tail.indexOf('## The tail'));
const handoff = read('.claude/skills/speckit-auto/hand-off.md');
const lifecycle = read('.claude/skills/speckit-auto/lifecycle.md');
const prTest = read('.claude/skills/speckit-pr-test/SKILL.md');
const watch = read('.claude/skills/speckit-watch/SKILL.md');
const NEEDED = /merge-main\.mjs --needed/;

// @traces 1357-FR-001
describe('the constitution merges main on overlap, not on behind', () => {
  const constitution = read('.specify/memory/constitution.md');
  const seven = constitution.slice(constitution.indexOf('### VII.'), constitution.indexOf('### ', constitution.indexOf('### VII.') + 8));

  it('is at 4.1.1, with its Sync Impact Report naming the owner\'s request', () => {
    assert.match(constitution, /\*\*Version\*\*: 4\.1\.1 \| \*\*Ratified\*\*: 2026-10-03 \| \*\*Last Amended\*\*: 2026-10-22/);
    assert.match(constitution, /Sync Impact Report \(v4\.1\.1\)[^>]*4\.1\.0 → 4\.1\.1 \(PATCH/);
  });

  it('says in VII that a behind branch merges main only when the overlap test needs it', () => {
    assert.match(seven, NEEDED);
    assert.match(seven, /only when/);
    assert.doesNotMatch(seven, /Merge `origin\/main` into the branch if it is behind/);
  });

  it('says the same in the card and in AGENTS.md step 5', () => {
    assert.match(read('.specify/memory/constitution-card.md'), /main merged in only on overlap/);
    const agents = read('AGENTS.md');
    const five = agents.slice(agents.indexOf(' 5. Get CI green'), agents.indexOf(' 6. QA'));
    assert.match(five, NEEDED);
    assert.doesNotMatch(five, /merge `origin\/main` when behind/);
  });
});

// @traces 1357-FR-004
// @traces 1357-FR-005
describe('every caller asks the overlap test before merging main', () => {
  it('the tail, before the review and again before the merge', () => {
    assert.match(step(tailSteps, 1, 2), NEEDED);
    assert.doesNotMatch(step(tailSteps, 1, 2), /If the branch is behind `origin\/main`, merge it in/);
    assert.match(step(tailSteps, 4, 5), NEEDED);
    assert.doesNotMatch(step(tailSteps, 4, 5), /if it moved/);
  });

  it('keeps a clean behind head with its run and agent-review, in the tail and the lifecycle', () => {
    for (const text of [step(tailSteps, 1, 2), step(lifecycle, 5, 6)]) {
      assert.match(text, /exit 1/);
      assert.match(text, /agent-review/);
    }
    assert.match(step(lifecycle, 5, 6), NEEDED);
  });

  it('the PR tester\'s rule for a PR waiting in QA after a merge', () => {
    assert.match(prTest, /After a merge, a PR waiting in QA[^.]*merge-main\.mjs --needed/);
  });

  it('the watcher\'s merge and merge-main fixes', () => {
    const row = (fix) => watch.match(new RegExp(`\\| \`${fix}\` \\|[^|]*\\|`))?.[0] ?? '';
    assert.match(row('merge'), NEEDED);
    assert.match(row('merge-main'), NEEDED);
  });

  it('treats exit 2 as needed wherever it is asked', () => {
    for (const text of [step(tailSteps, 1, 2), step(lifecycle, 5, 6)]) assert.match(text, /exit 2/);
  });

  it('never merges a pull request\'s merge ref', () => {
    const skills = join(root, '.claude', 'skills');
    const files = readdirSync(skills, { recursive: true }).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const p = join(skills, f);
      if (statSync(p).isFile()) assert.doesNotMatch(readFileSync(p, 'utf8'), /merge[^\n]*refs\/pull\/[^\n]*\/merge/, f);
    }
  });
});

// @traces 1357-FR-007
// @traces 1357-FR-008
describe('the live flows proof is written down where a dispatch is made', () => {
  const noRun = tailSteps.slice(tailSteps.indexOf('**No run for the head**'), tailSteps.indexOf('**An unusable run**'));
  const one = step(handoff, 1, 2);

  for (const [where, text] of [['hand-off step 1', one], ["the tail's no-run case", noRun]]) {
    it(`${where}: boot the stack, check until exit 0, exit 64, no escape, Docker-less blocks`, () => {
      assert.ok(text.includes('eval "$(node scripts/test-services.ts origin/main)"'), text);
      assert.match(text, /precheck\.mjs --flows [^`]* --spec [^`]* --check/);
      assert.match(text, /until it exits 0/);
      assert.match(text, /exit 64[^.]*no (live )?proof[^.]*head/i);
      assert.match(text, /no flag/i);
      assert.match(text, /Docker[^.]*needs-confirmation/);
    });
  }

  it('offers no way to dispatch without the proof', () => {
    for (const text of [handoff, tail, read('.claude/agents/pr-tester.md'), prTest])
      assert.doesNotMatch(text, /--no-proof|--skip-proof|SPECKIT_SKIP_PROOF/);
  });
});

// @traces 1357-FR-010
describe('turning dispatch on after a gate-only week', () => {
  it('is said in the script header and in the watch skill', () => {
    const header = read('scripts/watch-schedule.sh').split(' LABEL=')[0];
    const scheduling = watch.slice(watch.indexOf('## Keeping it scheduled'), watch.indexOf('## Limits'));
    for (const text of [header, scheduling]) {
      assert.match(text, /install --gate-only/);
      assert.match(text, /a week of plan files/);
      assert.match(text, /no line a person would refuse/);
      assert.match(text, /uninstall/);
    }
  });

  it('is named in AGENTS.md\'s watch paragraph', () => {
    assert.match(read('AGENTS.md'), /watch-schedule\.sh install --gate-only/);
  });
});

// @traces 1357-FR-012
describe('the tail records its finish before a pending check ends it', () => {
  it('writes finish-comment.md through the specs repo before NEXT: merge after CI', () => {
    const four = step(tailSteps, 4, 5);
    const write = four.indexOf('finish-comment.md');
    const pending = four.indexOf('NEXT: merge #<n> after CI');
    assert.ok(write !== -1 && pending !== -1, four);
    assert.ok(write < pending, 'the write comes before the pending-check end');
    assert.match(four.slice(write, pending), /specs-repo\.mjs commit/);
  });
});

// @traces 1357-FR-013
describe('no gate script is left unblessed', () => {
  it('every registered hook script still matches the fingerprint recorded for it', async () => {
    const { fingerprint } = await import('./lib/hooks.mjs');
    const registry = JSON.parse(readFileSync(join(root, '.claude', 'hooks', 'registry.json'), 'utf8'));
    const entries = [...Object.values(registry.hooks ?? {}), ...Object.values(registry.helpers ?? {})].filter((e) => e?.script && e?.fingerprint);
    assert.ok(entries.length > 0);
    for (const e of entries) assert.equal(fingerprint(join(root, '.claude', 'hooks', e.script)), e.fingerprint, e.script);
  });
});

// @traces 1357-FR-014
describe('the skills this change edits are the project\'s own', () => {
  it('none of them is a stock spec-kit file, so no override marker is owed', () => {
    const stock = Object.keys(JSON.parse(readFileSync(join(root, '.specify', 'integrations', 'claude.manifest.json'), 'utf8')).files);
    for (const f of ['.claude/skills/speckit-auto/tail.md', '.claude/skills/speckit-auto/hand-off.md', '.claude/skills/speckit-auto/lifecycle.md', '.claude/skills/speckit-pr-test/SKILL.md', '.claude/skills/speckit-watch/SKILL.md'])
      assert.ok(!stock.includes(f), f);
  });
});
