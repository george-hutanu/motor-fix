import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkPrBody } from './pr-body-check.ts';

const template = readFileSync(
  join(__dirname, '..', '.github', 'pull_request_template.md'),
  'utf8',
);

const answers: Record<string, string> = {
  'command and result, or N/A and why': '`npx jest <spec>` — all passed',
  'desktop and mobile screenshots of each changed screen, or N/A: no UI change':
    'N/A: no screen changed',
  'specs/NNN-slug in motor-fix-specs, or N/A and why': '`specs/001-example`',
  'the main changes, one bullet each': '- Adds the template\n- Adds the check',
  'the story link, e.g. https://app.notion.com/p/… (ST-n)':
    'https://app.notion.com/p/0000000000000000000000000000000a (ST-1)',
  'what could break, and how to undo it':
    'A PR body the check misreads; revert the workflow.',
  'what this change adds - service, queue, endpoint, outside call, product action - and the signals, dashboard panel and alert that come with it, or N/A and the reason':
    'N/A: adds no service, queue, endpoint, outside call or product action',
  'what this PR does and why, in two or three sentences':
    'Every PR tells the reviewer the same things.',
};

function filled(): string {
  return template
    .replace(/_\(fill in: ([^)]*\)?)\)_/g, (_, hint: string) => {
      const answer = answers[hint];
      if (!answer) throw new Error(`no answer for placeholder: ${hint}`);
      return answer;
    })
    .replaceAll('- [ ]', '- [x]');
}

const title = 'feat(ci): ST-1 enforce the PR template';

function ready(body: string | null, prTitle = title) {
  return checkPrBody({ body, draft: false, template, title: prTitle });
}

function withSection(body: string, heading: string, content: string) {
  return body.replace(
    new RegExp(`(## ${heading}\\n)[\\s\\S]*?(?=\\n## |$)`),
    `$1\n${content}\n`,
  );
}

describe('the pull request template', () => {
  it('has every required section', () => {
    const headings = [...template.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'Why',
      'Notion story',
      'Spec folder',
      'What changed',
      'How it was tested',
      'Observability',
      'UI evidence',
      'Risk and rollback',
      'Checklist',
      'Agent review',
    ]);
    expect(template).toMatch(/- Unit:/);
    expect(template).toMatch(/- Integration:/);
    expect(template).toMatch(/- End-to-end:/);
    expect(template).toMatch(/desktop and mobile/);
    expect(template).toMatch(/signals, dashboard panel and alert/);
    for (const item of [
      'Conventional Commit',
      'Tests were written first',
      'Design checked',
      'Notion in sync',
    ]) {
      expect(template).toMatch(new RegExp(`- \\[ \\] .*${item}`));
    }
  });
});

describe('checkPrBody on a ready PR', () => {
  it('passes a body filled in from the template', () => {
    expect(ready(filled())).toEqual([]);
  });

  it('passes with Windows line endings', () => {
    expect(ready(filled().replaceAll('\n', '\r\n'))).toEqual([]);
  });

  it('passes a section answered N/A with a reason', () => {
    const body = withSection(filled(), 'Spec folder', 'N/A — level 0 change');
    expect(ready(body)).toEqual([]);
  });

  it('passes an Agent review still pending', () => {
    expect(filled()).toMatch(/Pending\./);
    expect(ready(filled())).toEqual([]);
  });

  it('passes extra sections and headings in another case', () => {
    const body = `${filled().replace('## Why', '## why  ')}\n## Notes\n\nMore.\n`;
    expect(ready(body)).toEqual([]);
  });

  it('names a missing section', () => {
    const body = filled().replace(
      /## Risk and rollback\n[\s\S]*?(?=\n## )/,
      '',
    );
    expect(ready(body)).toEqual(['Missing section: "## Risk and rollback".']);
  });

  it('reports every section of an empty body', () => {
    const problems = ready(null);
    expect(problems).toHaveLength(10);
    expect(problems[0]).toBe('Missing section: "## Why".');
  });

  it('names a section that keeps a placeholder', () => {
    const body = withSection(
      filled(),
      'What changed',
      '_(fill in: the main changes, one bullet each)_',
    );
    expect(ready(body)).toEqual([
      '"## What changed" still has template placeholder text: "(fill in: the main changes, one bullet each)".',
    ]);
  });

  it('names an empty section, counting a comment as empty', () => {
    const body = withSection(filled(), 'Why', '<!-- later -->');
    expect(ready(body)).toEqual(['"## Why" is empty.']);
  });

  it('refuses a bare N/A', () => {
    const body = withSection(filled(), 'UI evidence', 'N/A');
    expect(ready(body)).toEqual([
      '"## UI evidence" says N/A without a reason.',
    ]);
  });

  it('names a labelled line removed from its section', () => {
    const body = filled().replace(/- Integration:.*\n/, '');
    expect(ready(body)).toEqual([
      '"## How it was tested" is missing its "Integration:" line.',
    ]);
  });

  it('names a labelled line left empty', () => {
    const body = filled().replace(/- Integration:.*/, '- Integration:');
    expect(ready(body)).toEqual([
      '"## How it was tested" leaves "Integration:" empty.',
    ]);
  });

  it('reads a repeated heading in another case as the first one', () => {
    expect(ready(`${filled()}\n## WHY\n`)).toEqual([]);
  });

  it('does not take prose about a placeholder for one', () => {
    const body = withSection(
      filled(),
      'Why',
      'Drops the (fill in: x) wording from the docs.',
    );
    expect(ready(body)).toEqual([]);
  });

  it('names a labelled line answered with a bare N/A', () => {
    const body = filled().replace(/- End-to-end:.*/, '- End-to-end: N/A');
    expect(ready(body)).toEqual([
      '"## How it was tested" answers "End-to-end:" N/A without a reason.',
    ]);
  });

  it('quotes an unticked checklist box', () => {
    const body = filled().replace('- [x] Tests were', '- [ ] Tests were');
    expect(ready(body)).toEqual([
      '"## Checklist" has an unticked box: "Tests were written first and failed before the code".',
    ]);
  });

  it('names a checklist box deleted instead of ticked', () => {
    const body = filled().replace(/- \[x\] Tests were.*\n/, '');
    expect(ready(body)).toEqual([
      '"## Checklist" is missing its box: "Tests were written first and failed before the code".',
    ]);
  });

  it('does not excuse an unticked box that says N/A', () => {
    const body = filled().replace(
      /- \[x\] Design checked.*/,
      '- [ ] Design checked: N/A, no screens',
    );
    expect(ready(body)).toEqual([
      '"## Checklist" has an unticked box: "Design checked: N/A, no screens".',
    ]);
  });

  it('ignores headings and placeholders inside code fences', () => {
    const fenced =
      'Why it matters.\n\n```md\n## Spec folder\n_(fill in: x)_\n```';
    const body = withSection(filled(), 'Why', fenced);
    expect(ready(body)).toEqual([]);
    const unfilled = body.replace(
      '`specs/001-example`',
      '_(fill in: specs/NNN-slug, or N/A and why)_',
    );
    expect(ready(unfilled)).toEqual([
      '"## Spec folder" still has template placeholder text: "(fill in: specs/NNN-slug, or N/A and why)".',
    ]);
  });

  it('reads headings with closing hashes or a little indent', () => {
    const body = filled()
      .replace('## Why', '## Why ##')
      .replace('## Spec folder', '  ## Spec folder');
    expect(ready(body)).toEqual([]);
  });

  it('accepts an upper-case tick', () => {
    expect(ready(filled().replaceAll('- [x]', '- [X]'))).toEqual([]);
  });

  it('refuses a title that is not a Conventional Commit with a scope', () => {
    for (const bad of ['Enforce the PR template', 'feat: no scope', '']) {
      expect(ready(filled(), bad)).toEqual([
        `Title "${bad}" is not a Conventional Commit with a scope, e.g. "feat(api): ST-1 subject".`,
      ]);
    }
    expect(ready(filled(), 'fix(web)!: ST-2 breaking')).toEqual([]);
  });

  it('wants a Notion link or N/A with a reason in the Notion story section', () => {
    const body = withSection(filled(), 'Notion story', 'ST-1');
    expect(ready(body)).toEqual([
      '"## Notion story" has no Notion link (or N/A and the reason).',
    ]);
    const na = withSection(filled(), 'Notion story', 'N/A: dependency bump');
    expect(ready(na)).toEqual([]);
    const legacy = withSection(
      filled(),
      'Notion story',
      'https://www.notion.so/motorfix/ST-1-abc',
    );
    expect(ready(legacy)).toEqual([]);
  });
});

describe('checkPrBody on a draft PR', () => {
  const draft = (body: string | null) =>
    checkPrBody({ body, draft: true, template, title: 'WIP' });

  it('passes the unchanged template', () => {
    expect(draft(template)).toEqual([]);
  });

  it('names a missing section', () => {
    const body = template.replace('## Agent review', '## Review');
    expect(draft(body)).toEqual(['Missing section: "## Agent review".']);
  });
});
