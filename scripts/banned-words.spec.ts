// @traces 1037-FR-010 1037-FR-011
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type BannedList,
  countMentions,
  listErrors,
  scanRepo,
} from './banned-words.ts';

// A made-up word stands in for the banned one, so this spec names nothing the
// real list bans.
const WORD = 'zorblax';
const list = (allow: BannedList['allow'] = {}, words = [WORD]): BannedList => ({
  allow,
  words,
});
const entry = (count: number, reason = 'history') => ({ count, reason });

describe('countMentions', () => {
  it('counts the word in the path and the text, whatever its case', () => {
    expect(
      countMentions('lib/Zorblax.ts', 'a ZORBLAX and a zorblax-sync', [WORD]),
    ).toBe(3);
  });

  it('counts every listed word', () => {
    expect(countMentions('a.md', 'zorblax quux', [WORD, 'quux'])).toBe(2);
  });

  it('is 0 when neither path nor text names it', () => {
    expect(countMentions('a.md', 'nothing here', [WORD])).toBe(0);
  });
});

describe('listErrors', () => {
  it('passes a file with no mention that is not listed', () => {
    expect(listErrors(new Map([['a.md', 0]]), list())).toEqual([]);
  });

  it('fails an unlisted file that mentions the word, naming it', () => {
    const errors = listErrors(new Map([['src/a.ts', 2]]), list());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/a.ts');
    expect(errors[0]).toContain('scripts/banned-words.json');
  });

  it('passes a listed file at its count', () => {
    expect(
      listErrors(new Map([['a.md', 2]]), list({ 'a.md': entry(2) })),
    ).toEqual([]);
  });

  it('fails a listed file above its count', () => {
    const errors = listErrors(
      new Map([['a.md', 3]]),
      list({ 'a.md': entry(2) }),
    );
    expect(errors).toEqual([expect.stringContaining('a.md')]);
    expect(errors[0]).toMatch(/3.*2/);
  });

  it('fails a listed file below its count as stale', () => {
    const errors = listErrors(
      new Map([['a.md', 1]]),
      list({ 'a.md': entry(2) }),
    );
    expect(errors).toEqual([expect.stringMatching(/stale.*a\.md/)]);
  });

  it('fails an entry for a file that is gone as stale', () => {
    const errors = listErrors(new Map(), list({ 'gone.md': entry(1) }));
    expect(errors).toEqual([expect.stringMatching(/stale.*gone\.md/)]);
  });

  it('fails an entry with no reason', () => {
    const errors = listErrors(
      new Map([['a.md', 1]]),
      list({ 'a.md': entry(1, ' ') }),
    );
    expect(errors).toEqual([expect.stringMatching(/a\.md.*reason/)]);
  });

  describe('against the base list', () => {
    const files = new Map([
      ['a.md', 2],
      ['b.md', 1],
    ]);
    const now = list({ 'a.md': entry(2), 'b.md': entry(1) });

    it('passes when every entry and count was already there', () => {
      expect(
        listErrors(files, now, {
          list: list({ 'a.md': entry(2), 'b.md': entry(4) }),
          ref: 'origin/main',
        }),
      ).toEqual([]);
    });

    it('fails an entry the base lacks', () => {
      const errors = listErrors(files, now, {
        list: list({ 'a.md': entry(2) }),
        ref: 'origin/main',
      });
      expect(errors).toEqual([expect.stringMatching(/b\.md.*origin\/main/)]);
    });

    it('fails a count higher than the base allowed', () => {
      const errors = listErrors(files, now, {
        list: list({ 'a.md': entry(1), 'b.md': entry(1) }),
        ref: 'origin/main',
      });
      expect(errors).toEqual([expect.stringMatching(/a\.md.*origin\/main/)]);
    });

    it('fails a word the base did not ban dropped from the list', () => {
      const errors = listErrors(files, list(now.allow, []), {
        list: now,
        ref: 'origin/main',
      });
      expect(errors).toEqual([expect.stringContaining(WORD)]);
    });

    it('checks no growth when the base has no list yet', () => {
      expect(
        listErrors(files, now, { list: null, ref: 'origin/main' }),
      ).toEqual([]);
    });
  });
});

describe('the CLI on a repository', () => {
  const script = join(__dirname, 'banned-words.ts');
  let repo: string;
  // A git hook exports GIT_DIR and GIT_INDEX_FILE; left in place they point
  // every command here at the real repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env });
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const commitAll = () => {
    git('add', '-A');
    git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-q',
      '-m',
      'x',
    );
  };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env,
    });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'banned-words-'));
    git('init', '-q', '-b', 'main');
    write(
      'scripts/banned-words.json',
      `${JSON.stringify(list({ 'old.md': entry(1) }), null, 2)}\n`,
    );
    write('old.md', 'once: zorblax\n');
    write('src/a.ts', 'export const a = 1;\n');
    commitAll();
  });

  afterEach(() => rmSync(repo, { force: true, recursive: true }));

  it('exits 0 when every mention is listed, never counting the list itself', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('exits 1 naming a tracked file that adds the word', () => {
    write('src/a.ts', '// see zorblax\n');
    git('add', '-A');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/a.ts');
  });

  it('counts the path of a file named after the word', () => {
    write('src/zorblax.ts', 'export {};\n');
    git('add', '-A');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/zorblax.ts');
  });

  it('with --base, exits 1 when the list grew since the ref', () => {
    git('branch', 'base');
    write('new.md', 'zorblax\n');
    write(
      'scripts/banned-words.json',
      `${JSON.stringify(list({ 'new.md': entry(1), 'old.md': entry(1) }), null, 2)}\n`,
    );
    commitAll();
    expect(run().status).toBe(0);
    const r = run('--base', 'base');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('new.md');
  });

  it('exits 1 when --base is not a commit', () => {
    const r = run('--base', 'no-such-ref');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no-such-ref');
  });
});

describe('this repository', () => {
  it('holds the banned words only where the list allows them', () => {
    const root = join(__dirname, '..');
    const { files, list: real } = scanRepo(root);
    expect(listErrors(files, real)).toEqual([]);
  });
});
