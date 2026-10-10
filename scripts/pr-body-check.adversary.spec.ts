import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkPrBody } from './pr-body-check.ts';

const root = join(__dirname, '..');
const template = readFileSync(
  join(root, '.github', 'pull_request_template.md'),
  'utf8',
);
const [retired] = (
  JSON.parse(readFileSync(join(__dirname, 'banned-words.json'), 'utf8')) as {
    words: string[];
  }
).words;
const Retired = retired.charAt(0).toUpperCase() + retired.slice(1);

const LINK = 'https://github.com/george-hutanu/motor-fix-specs/issues/60';
const NO_STORY_LINK =
  '"## Story" has no link to the story (its issue in george-hutanu/motor-fix-specs), or N/A and the reason.';
const title = 'feat(ci): ST-1 enforce the PR template';

function filled(storyContent = `${LINK} (ST-1)`): string {
  return [
    '## Why\n\nBecause.',
    `## Story\n\n${storyContent}`,
    '## Spec folder\n\n`specs/001-example`',
    '## What changed\n\n- one',
    '## How it was tested\n\n- Unit: ran, passed\n- Integration: N/A: none\n- End-to-end: N/A: none',
    '## Observability\n\nN/A: nothing new',
    '## UI evidence\n\nN/A: no UI change',
    '## Risk and rollback\n\nRevert.',
    "## Checklist\n\n- [x] Title is a Conventional Commit with a scope: `type(scope): ST-n subject`\n- [x] Tests were written first and failed before the code\n- [x] Design checked: `specs/<feature>/design.md`, or the story has no screens\n- [x] Tracker in sync: the story's issue is Planning",
    '## Agent review\n\nPending.',
  ].join('\n\n');
}

function ready(body: string | null, draft = false) {
  return checkPrBody({ body, draft, template, title });
}

describe('PR body check, retired tracker form', () => {
  it('refuses a retired-host link on a subdomain', () => {
    const body = filled(`https://my-team.${retired}.site/page-0123456789`);
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses a retired-host link written in upper case', () => {
    const body = filled(`HTTPS://${Retired.toUpperCase()}.SO/page`);
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses a mixed body on the legacy parts only', () => {
    const body = filled(`https://${retired}.so/x`).replace(
      'Tracker in sync',
      `${Retired} in sync`,
    );
    expect(ready(body)).toEqual([
      NO_STORY_LINK,
      expect.stringMatching(
        /^"## Checklist" is missing its box: "Tracker in sync/,
      ),
    ]);
  });

  it('passes a story link wrapped in emphasis or a Markdown link', () => {
    for (const story of [
      `**${LINK}**`,
      `_${LINK}_`,
      `[ST-1](${LINK})`,
      `<${LINK}>`,
    ])
      expect(ready(filled(story))).toEqual([]);
  });

  it('refuses a link to another repository of the same owner', () => {
    const body = filled('https://github.com/george-hutanu/motor-fix/issues/60');
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses an issues link with no number', () => {
    const body = filled(
      'https://github.com/george-hutanu/motor-fix-specs/issues/',
    );
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses a pull request link in the specs repo', () => {
    const body = filled(
      'https://github.com/george-hutanu/motor-fix-specs/pull/60',
    );
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses the specs-repo link when it is only a query value of a foreign host', () => {
    const body = filled(`https://example.com/?u=${LINK}`);
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses a specs-repo link with a non-numeric issue id', () => {
    const body = filled(
      'https://github.com/george-hutanu/motor-fix-specs/issues/abc',
    );
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses a retired link that merely follows a Closes line', () => {
    const body = filled(
      `Closes george-hutanu/motor-fix-specs#60\n\nhttps://${retired}.so/x`,
    );
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });

  it('refuses a bare N/A in the story section', () => {
    expect(ready(filled('N/A'))).toEqual([
      '"## Story" says N/A without a reason.',
    ]);
  });

  it('refuses an empty story section', () => {
    expect(ready(filled(''))).toEqual(['"## Story" is empty.']);
  });

  it('accepts CRLF line endings', () => {
    expect(ready(filled().replace(/\n/g, '\r\n'))).toEqual([]);
  });

  it('reports every section for a null body', () => {
    expect(ready(null, true)).toHaveLength(10);
  });

  it('ignores a retired heading inside a code fence', () => {
    const body = `${filled()}\n\n\`\`\`\n## ${Retired} story\n\`\`\`\n`;
    expect(ready(body)).toEqual([]);
  });

  it('refuses a retired link hidden in an HTML comment', () => {
    const body = filled(`<!-- ${LINK} -->\nhttps://${retired}.so/x`);
    expect(ready(body)).toEqual([NO_STORY_LINK]);
  });
});

describe('PR body check, command line', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prbody-'));
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  function run(body: string, extra: string[] = []) {
    const file = join(dir, 'body.md');
    return writeFile(file, body).then(() =>
      spawnSync(
        process.execPath,
        [
          'scripts/pr-body-check.ts',
          '--body-file',
          file,
          '--title',
          title,
          ...extra,
        ],
        { cwd: root, encoding: 'utf8' },
      ),
    );
  }

  it('exits 0 on a filled body', async () => {
    const result = await run(filled());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('The PR follows the template.');
  });

  it('exits 1 naming the missing story link for a retired link', async () => {
    const result = await run(filled(`https://${retired}.so/x`));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(NO_STORY_LINK);
  });

  it('exits 1 for a retired heading on a draft', async () => {
    const result = await run(
      filled().replace('## Story', `## ${Retired} story`),
      ['--draft'],
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing section: "## Story".');
  });

  it('exits 1 on an empty body file', async () => {
    const result = await run('');
    expect(result.status).toBe(1);
  });
});
