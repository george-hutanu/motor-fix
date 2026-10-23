import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EMAIL_PALETTE } from './email';
import { COCKPIT_COLOURS } from './generated/colours';

const libRoot = join(__dirname, '..');
const realCss = readFileSync(join(__dirname, 'styles/cockpit.css'), 'utf8');

let sandboxes: string[] = [];

function sandbox(css = realCss) {
  const dir = mkdtempSync(join(tmpdir(), 'colours-adv-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'src/styles'), { recursive: true });
  mkdirSync(join(dir, 'src/generated'), { recursive: true });
  copyFileSync(
    join(libRoot, 'scripts/colours.mjs'),
    join(dir, 'scripts/colours.mjs'),
  );
  writeFileSync(join(dir, 'src/styles/cockpit.css'), css);
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [join(dir, 'scripts/colours.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  const out = join(dir, 'src/generated/colours.ts');
  return { css: join(dir, 'src/styles/cockpit.css'), dir, out, run };
}

afterEach(() => {
  for (const dir of sandboxes) rmSync(dir, { force: true, recursive: true });
  sandboxes = [];
});

describe('the colours generator', () => {
  it('writes the same file twice and then passes its own check', () => {
    const s = sandbox();

    expect(s.run().status).toBe(0);
    const first = readFileSync(s.out, 'utf8');
    expect(s.run().status).toBe(0);

    expect(readFileSync(s.out, 'utf8')).toBe(first);
    expect(s.run('--check').status).toBe(0);
  });

  it('writes a module equal to the committed one from the committed stylesheet', () => {
    const s = sandbox();
    s.run();

    expect(readFileSync(s.out, 'utf8')).toBe(
      readFileSync(join(__dirname, 'generated/colours.ts'), 'utf8'),
    );
  });

  it('fails the check and writes nothing when the module is missing', () => {
    const s = sandbox();

    const check = s.run('--check');

    expect(check.status).toBe(1);
    expect(existsSync(s.out)).toBe(false);
  });

  it('fails the check and leaves a hand-edited module as it was', () => {
    const s = sandbox();
    s.run();
    const edited = readFileSync(s.out, 'utf8').replace('#0b0c0e', '#000000');
    writeFileSync(s.out, edited);

    const check = s.run('--check');

    expect(check.status).toBe(1);
    expect(readFileSync(s.out, 'utf8')).toBe(edited);
  });

  it('fails the check after a colour token changes and follows it once run', () => {
    const s = sandbox();
    s.run();
    writeFileSync(
      s.css,
      realCss.replace('--mf-bg: #0b0c0e;', '--mf-bg: #123456;'),
    );

    expect(s.run('--check').status).toBe(1);
    s.run();

    expect(readFileSync(s.out, 'utf8')).toContain("'--mf-bg': '#123456'");
    expect(s.run('--check').status).toBe(0);
  });

  it('gives the same module for a stylesheet with CRLF line endings', () => {
    const lf = sandbox();
    lf.run();
    const crlf = sandbox(realCss.replace(/\n/g, '\r\n'));
    crlf.run();

    expect(readFileSync(crlf.out, 'utf8')).toBe(readFileSync(lf.out, 'utf8'));
  });

  it('keeps the colours of a block that holds a comment with a closing brace', () => {
    const css = realCss.replace(
      ':root {\n  color-scheme: dark;',
      ':root {\n  /* old: } */\n  color-scheme: dark;',
    );
    const s = sandbox(css);
    s.run();

    expect(readFileSync(s.out, 'utf8')).toContain("'--mf-bg': '#0b0c0e'");
    expect(readFileSync(s.out, 'utf8')).toContain("'--mf-text': '#f2f2f0'");
  });

  it('ignores a colour in a comment', () => {
    const css = realCss.replace(
      '  --mf-bg: #0b0c0e;',
      '  /* --mf-ghost: #abcdef; */\n  --mf-bg: #0b0c0e;',
    );
    const s = sandbox(css);
    s.run();

    expect(readFileSync(s.out, 'utf8')).not.toContain('--mf-ghost');
  });

  it('leaves out lengths, durations and environment values', () => {
    const css = realCss.replace(
      '  --mf-bg: #0b0c0e;',
      '  --mf-bg: #0b0c0e;\n  --mf-length: 12px;\n  --mf-env: env(safe-area-inset-top, 0px);',
    );
    const s = sandbox(css);
    s.run();
    const text = readFileSync(s.out, 'utf8');

    expect(text).not.toContain('--mf-length');
    expect(text).not.toContain('--mf-env');
    expect(text).not.toContain('--mf-motion-rise');
  });

  it('never writes undefined for a token only one scheme defines', () => {
    const css = realCss.replace(
      '    --mf-bg: #f4f4f1;',
      '    --mf-bg: #f4f4f1;\n    --mf-only-light: #abcdef;',
    );
    const s = sandbox(css);
    const run = s.run();

    expect(run.status === 0 || run.stderr.includes('--mf-only-light')).toBe(
      true,
    );
    if (run.status === 0)
      expect(readFileSync(s.out, 'utf8')).not.toContain('undefined');
  });

  it('exits non-zero rather than writing an empty light set when the light block is gone', () => {
    const start = realCss.indexOf('@media (prefers-color-scheme: light)');
    const end = realCss.indexOf('\n}\n', start) + 3;
    const s = sandbox(realCss.slice(0, start) + realCss.slice(end));

    const run = s.run();

    expect(run.status).not.toBe(0);
  });

  it('exits non-zero for an empty stylesheet instead of writing empty sets', () => {
    const s = sandbox('');

    expect(s.run().status).not.toBe(0);
  });

  it('checks the committed module from another working directory', () => {
    const check = spawnSync(
      process.execPath,
      [join(libRoot, 'scripts/colours.mjs'), '--check'],
      { cwd: tmpdir(), encoding: 'utf8' },
    );

    expect(check.status).toBe(0);
  });
});

describe('the generated colours module', () => {
  const sets = ['dark', 'light'] as const;

  it('has the same token names in both schemes', () => {
    expect(Object.keys(COCKPIT_COLOURS.dark).sort()).toEqual(
      Object.keys(COCKPIT_COLOURS.light).sort(),
    );
  });

  it.each(sets)('holds only colour values in the %s set', (set) => {
    for (const [name, value] of Object.entries(COCKPIT_COLOURS[set])) {
      expect(`${name} ${value}`).toMatch(
        /^--mf-[\w-]+ (#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i,
      );
    }
  });
});

describe('the e-mail palette', () => {
  it('holds plain six-digit hex values a mail client can read', () => {
    for (const value of Object.values(EMAIL_PALETTE))
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('carries the light set values of the generated module', () => {
    expect(EMAIL_PALETTE).toEqual({
      amber: COCKPIT_COLOURS.light['--mf-amber'],
      bg: COCKPIT_COLOURS.light['--mf-bg'],
      line: COCKPIT_COLOURS.light['--mf-line'],
      onAmber: COCKPIT_COLOURS.light['--mf-on-amber'],
      panel: COCKPIT_COLOURS.light['--mf-panel'],
      text: COCKPIT_COLOURS.light['--mf-text'],
      textSecondary: COCKPIT_COLOURS.light['--mf-text-secondary'],
    });
  });

  it('imports nothing from Angular, directly or through the generated module', () => {
    for (const file of ['email.ts', 'generated/colours.ts'])
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(
        /@angular|from '\.\/lib|from '\.\/index/,
      );
  });
});

describe('the medium radius token', () => {
  it('is defined once in the dark root block as the control radius', () => {
    expect(realCss.match(/--mf-radius-md\s*:[^;]+;/g)).toEqual([
      '--mf-radius-md: var(--mf-radius-control);',
    ]);
    expect(realCss).toMatch(/--mf-radius-control:\s*12px;/);
  });

  it('is written with a fallback nowhere in the repository', () => {
    const grep = spawnSync(
      'git',
      ['grep', '-n', '-F', 'var(--mf-radius-md,', '--', ':!*.spec.ts'],
      { cwd: libRoot, encoding: 'utf8' },
    );

    expect(grep.stdout).toBe('');
    expect(grep.status).toBe(1);
  });
});
