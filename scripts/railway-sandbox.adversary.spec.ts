import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createInput,
  type Kind,
  maskLines,
  prelude,
  type Run,
  railwayApi,
  references,
  refusal,
  waitRunning,
} from './railway-sandbox.ts';

const script = join(__dirname, 'railway-sandbox.ts');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-adv-'));
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

// @traces 1371-FR-003
describe('references, hostile service names', () => {
  it.each([
    ['a trailing newline', 'Postgres\n'],
    ['an expression opener', '$\x7b{x}}'],
    ['a closing brace', 'a}b'],
    ['a leading space', ' Postgres'],
    ['a quote', 'Post"gres'],
    ['unicode letters', 'Postgrés'],
    ['a dollar sign', 'a$b'],
    ['a null byte', 'a\0b'],
  ])('refuses a service name with %s', (_title, name) => {
    expect(() => references('postgres', name)).toThrow(/service name/);
    expect(() => references('api', name)).toThrow(/service name/);
  });

  it('refuses a dotted service name, which would make the reference ambiguous', () => {
    expect(() => references('postgres', 'my.db')).toThrow(/service name/);
  });

  it('gives createInput the very references that references gives', () => {
    for (const kind of ['postgres', 'api'] as Kind[]) {
      expect(createInput('env-1', kind, 'svc').variables).toEqual(
        references(kind, 'svc'),
      );
    }
  });

  it('never puts a literal value into the variables of either kind', () => {
    for (const kind of ['postgres', 'api'] as Kind[]) {
      const values = Object.values(createInput('e', kind, 'svc').variables);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(value).toMatch(/^\$\{\{svc\.\w+\}\}$/);
    }
  });

  it('asks for no TCP proxy and no domain of any kind', () => {
    const input = createInput('e', 'api', 'api') as Record<string, unknown>;
    expect(Object.keys(input).join(' ')).not.toMatch(/domain|proxy|tcp/i);
  });

  it('refuses an unknown kind instead of building a sandbox with no variables', () => {
    expect(() => createInput('e', 'constructor' as Kind, 'svc')).toThrow();
    expect(() => references('__proto__' as Kind, 'svc')).toThrow();
  });
});

// @traces 1371-FR-002
describe('refusal, boundaries', () => {
  it.each([
    ['upper case', 'Staging', 'postgres', 'Staging'],
    ['a trailing space', 'staging', 'postgres', 'staging '],
    ['an empty actual name', 'staging', 'postgres', ''],
    ['a prototype kind', 'staging', 'constructor', 'staging'],
    ['a prototype environment', 'toString', 'postgres', 'toString'],
    ['an empty kind', 'staging', '', 'staging'],
    ['a kind in capitals', 'staging', 'API', 'staging'],
  ])('refuses %s', (_title, environment, kind, actual) => {
    expect(refusal(environment, kind, actual)).toEqual(expect.any(String));
  });

  it('refuses every api sandbox outside staging whatever Railway names the environment', () => {
    for (const actual of ['production', 'staging', '']) {
      expect(refusal('production', 'api', actual)).toEqual(expect.any(String));
    }
  });

  it('does not echo anything but the names in its message', () => {
    const message = refusal('staging', 'postgres', 'production') ?? '';
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

// @traces 1371-FR-004
describe('prelude, hostile values', () => {
  const sh = (text: string, after: string) =>
    spawnSync('sh', [], { encoding: 'utf8', input: `${text}${after}` });

  it('prints nothing for an empty list of names', () => {
    expect(prelude({ A: 'x' }, [])).toBe('');
  });

  it.each([
    ['a leading digit', '1A'],
    ['an equals sign', 'A=B'],
    ['a newline', 'A\nB'],
    ['a dollar', '$A'],
    ['a space', 'A B'],
    ['a dash', 'A-B'],
    ['an empty name', ''],
  ])('refuses a name with %s', (_title, name) => {
    expect(() => prelude({ [name]: 'x' }, [name])).toThrow();
  });

  it('names the unset variable in the error but never another variable value', () => {
    let message = '';
    try {
      prelude({ A: 'topsecret' }, ['A', 'MISSING']);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('MISSING');
    expect(message).not.toContain('topsecret');
  });

  it('rebuilds an exotic value byte for byte in a shell', () => {
    const value = 'é€𝄞 \'x\' "y" $(id) `id` \\ \t ;|&<>*? # end';
    const text = prelude({ V: value }, ['V']);
    const out = sh(text, 'printf %s "$V"');
    expect(out.stdout).toBe(value);
  });

  it('rebuilds a multi-line value, keeping its inner newlines', () => {
    const value = 'line one\nline two\n\nline four';
    const out = sh(prelude({ V: value }, ['V']), 'printf %s "$V"');
    expect(out.stdout).toBe(value);
  });

  it('rebuilds a value that ends in a newline', () => {
    const value = 'passphrase\n';
    const out = sh(prelude({ V: value }, ['V']), 'printf %s "$V"');
    expect(out.stdout).toBe(value);
  });

  it('rebuilds a value that ends in several newlines', () => {
    const value = 'abc\n\n\n';
    const out = sh(prelude({ V: value }, ['V']), 'printf %s "$V"');
    expect(out.stdout).toBe(value);
  });

  it('exports each name to a child process', () => {
    const out = sh(prelude({ V: 'child' }, ['V']), 'sh -c \'printf %s "$V"\'');
    expect(out.stdout).toBe('child');
  });

  it('handles a 1 MB value in one line per name', () => {
    const value = 'x'.repeat(1_000_000);
    const text = prelude({ BIG: value }, ['BIG']);
    expect(text.split('\n').filter(Boolean)).toHaveLength(1);
    expect(sh(text, 'printf %s "$\x7b#BIG}"').stdout).toBe('1000000');
  });

  it('never leaks the raw value, whatever it holds', () => {
    const value = 'Tr0ub4dor&3-unique-marker';
    expect(prelude({ V: value }, ['V'])).not.toContain(value);
  });

  it('produces the same text twice for the same input', () => {
    const env = { A: 'a', B: 'b' };
    expect(prelude(env, ['A', 'B'])).toBe(prelude(env, ['A', 'B']));
  });
});

// @traces 1371-FR-004
describe('maskLines, hostile values', () => {
  it('prints nothing for no names', () => {
    expect(maskLines({ A: 'secret' }, [])).toEqual([]);
  });

  it('masks each line of a CRLF value without the carriage return', () => {
    const lines = maskLines({ K: 'one\r\ntwo' }, ['K']);
    expect(lines).toContain('::add-mask::one');
    expect(lines).toContain('::add-mask::two');
    expect(lines).toContain(
      `::add-mask::${Buffer.from('one\r\ntwo').toString('base64')}`,
    );
  });

  it('prints no mask for a blank inner line, which would hide every empty value', () => {
    const lines = maskLines({ K: 'one\n\n  \ntwo' }, ['K']);
    expect(lines).not.toContain('::add-mask::');
    expect(lines).not.toContain('::add-mask::  ');
  });

  it('prints one line per distinct form, with no duplicate', () => {
    const lines = maskLines({ A: 'same', B: 'same' }, ['A', 'B']);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('masks the base64 of a unicode value from its UTF-8 bytes', () => {
    const lines = maskLines({ K: 'pässwörd€' }, ['K']);
    expect(lines).toContain(
      `::add-mask::${Buffer.from('pässwörd€', 'utf8').toString('base64')}`,
    );
  });

  it('masks every named secret, not only the first', () => {
    const lines = maskLines({ A: 'aaa-1', B: 'bbb-2', C: 'ccc-3' }, [
      'A',
      'B',
      'C',
    ]);
    for (const raw of ['aaa-1', 'bbb-2', 'ccc-3']) {
      expect(lines).toContain(`::add-mask::${raw}`);
    }
  });

  it('only ever prints add-mask commands, even for a value that looks like a command', () => {
    const lines = maskLines({ K: '::error::boom\n::set-output name=x::y' }, [
      'K',
    ]);
    for (const line of lines)
      expect(line.startsWith('::add-mask::')).toBe(true);
  });

  it('masks a multi-line value in the order the log could print it, every line a separate command', () => {
    const lines = maskLines({ K: 'a1\nb2' }, ['K']);
    expect(lines.every((line) => !line.includes('\n'))).toBe(true);
  });
});

// @traces 1371-FR-002
describe('railwayApi, hostile answers', () => {
  const ok = (stdout: string, status = 0) => ({ status, stderr: '', stdout });
  const ctx = (run: Run, env: Record<string, string | undefined> = {}) => ({
    env: { RAILWAY_API_TOKEN: 'tok', ...env },
    run,
  });

  it('fails on an answer that is not JSON', () => {
    expect(() =>
      railwayApi(
        'q',
        {},
        ctx(() => ok('<html>502 Bad Gateway</html>')),
      ),
    ).toThrow();
  });

  it('fails on an empty answer with a zero status', () => {
    expect(() =>
      railwayApi(
        'q',
        {},
        ctx(() => ok('')),
      ),
    ).toThrow();
  });

  it('fails on a non-zero status with no output, using the stderr', () => {
    const run: Run = () => ({ status: 1, stderr: 'boom from cli', stdout: '' });
    expect(() => railwayApi('q', {}, ctx(run))).toThrow(/boom from cli/);
  });

  it('fails on a process killed by a signal, whose status is null', () => {
    const run: Run = () => ({ status: null, stderr: '', stdout: '' });
    expect(() => railwayApi('q', {}, ctx(run))).toThrow();
  });

  it('fails when data is null and no error is given', () => {
    expect(() =>
      railwayApi(
        'q',
        {},
        ctx(() => ok('{"data":null}')),
      ),
    ).toThrow();
  });

  it('fails when errors come with a zero status and data', () => {
    const body = JSON.stringify({
      data: { x: 1 },
      errors: [{ message: 'partial failure' }],
    });
    expect(() =>
      railwayApi(
        'q',
        {},
        ctx(() => ok(body)),
      ),
    ).toThrow(/partial failure/);
  });

  it('retries a refusal reported with a zero status', () => {
    const seen: Record<string, string | undefined>[] = [];
    const answers = [
      JSON.stringify({ data: null, errors: [{ message: 'Not Authorized' }] }),
      JSON.stringify({ data: { ok: true } }),
    ];
    const run: Run = (_args, env) => {
      seen.push(env);
      return ok(answers.shift() ?? '');
    };
    expect(railwayApi('q', {}, ctx(run))).toEqual({ ok: true });
    expect(seen[1]?.RAILWAY_TOKEN).toBe('tok');
  });

  it('asks Railway exactly twice, never more, when both forms are refused', () => {
    let calls = 0;
    const run: Run = () => {
      calls += 1;
      return ok(
        JSON.stringify({ data: null, errors: [{ message: 'Not Authorized' }] }),
        1,
      );
    };
    expect(() => railwayApi('q', {}, ctx(run))).toThrow(/Not Authorized/);
    expect(calls).toBe(2);
  });

  it('never sends both token variables in one call, even when the job holds both', () => {
    const seen: Record<string, string | undefined>[] = [];
    const run: Run = (_args, env) => {
      seen.push(env);
      return ok(JSON.stringify({ data: { ok: 1 } }));
    };
    railwayApi('q', {}, ctx(run, { RAILWAY_TOKEN: 'project-tok' }));
    expect(seen[0]?.RAILWAY_API_TOKEN).toBe('tok');
    expect(seen[0]?.RAILWAY_TOKEN).toBeUndefined();
  });

  it('passes variables as one JSON argument and never builds them into the query', () => {
    const calls: string[][] = [];
    const run: Run = (args) => {
      calls.push(args);
      return ok(JSON.stringify({ data: { ok: 1 } }));
    };
    const hostile = { id: 'a"}) { x } #\n é', n: 1 };
    railwayApi('query Q($id: String!) { x }', hostile, ctx(run));
    const args = calls[0] ?? [];
    expect(args[1]).toBe('query Q($id: String!) { x }');
    const at = args.indexOf('--variables');
    expect(JSON.parse(args[at + 1] ?? '')).toEqual(hostile);
  });

  it('does not put the token in any argument or in the error of a failing call', () => {
    const calls: string[][] = [];
    const run: Run = (args) => {
      calls.push(args);
      return { status: 1, stderr: 'network down', stdout: '' };
    };
    let message = '';
    try {
      railwayApi('q', {}, ctx(run, { RAILWAY_API_TOKEN: 'sekret-xyz' }));
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain('sekret-xyz');
    expect(calls.flat().join(' ')).not.toContain('sekret-xyz');
  });
});

// @traces 1371-FR-002
describe('waitRunning, boundaries', () => {
  function clock(states: string[]) {
    let t = 0;
    let sleeps = 0;
    return {
      now: () => t,
      read: () => states.shift() ?? 'CREATING',
      sleep: async (ms: number) => {
        sleeps += 1;
        t += ms;
      },
      sleeps: () => sleeps,
    };
  }

  it('returns at once, with no sleep, when the first read is RUNNING', async () => {
    const c = clock(['RUNNING']);
    await waitRunning(c.read, {
      limitMs: 60_000,
      now: c.now,
      pollMs: 5_000,
      sleep: c.sleep,
    });
    expect(c.sleeps()).toBe(0);
  });

  it('does not wait past the bound', async () => {
    const c = clock([]);
    await expect(
      waitRunning(c.read, {
        limitMs: 12_000,
        now: c.now,
        pollMs: 5_000,
        sleep: c.sleep,
      }),
    ).rejects.toThrow(/CREATING/);
    expect(c.now()).toBeLessThanOrEqual(15_000);
  });

  it('gives up on a zero bound after one look when it is not running', async () => {
    const c = clock([]);
    await expect(
      waitRunning(c.read, {
        limitMs: 0,
        now: c.now,
        pollMs: 5_000,
        sleep: c.sleep,
      }),
    ).rejects.toThrow(/CREATING/);
    expect(c.sleeps()).toBeLessThanOrEqual(1);
  });

  it.each(['FAILED', 'DESTROYED', 'STOPPED', 'ERROR'])(
    'stops at once on %s without spending the bound',
    async (state) => {
      const c = clock(['CREATING', state]);
      await expect(
        waitRunning(c.read, {
          limitMs: 300_000,
          now: c.now,
          pollMs: 5_000,
          sleep: c.sleep,
        }),
      ).rejects.toThrow(new RegExp(state));
      expect(c.now()).toBeLessThan(300_000);
    },
  );

  it('passes on the error of a read that throws, without sleeping on', async () => {
    const c = clock([]);
    await expect(
      waitRunning(
        () => {
          throw new Error('read failed');
        },
        { limitMs: 60_000, now: c.now, pollMs: 5_000, sleep: c.sleep },
      ),
    ).rejects.toThrow(/read failed/);
    expect(c.sleeps()).toBe(0);
  });
});

function fakeCli(options: { execExit?: number; envName?: string } = {}) {
  const log = join(dir, 'calls.jsonl');
  const stdinFile = join(dir, 'stdin.bin');
  const cli = join(dir, 'railway');
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'sandbox' && args[1] === 'exec') {
  fs.writeFileSync(${JSON.stringify(stdinFile)}, fs.readFileSync(0));
  process.stdout.write('BACKUP_SIZE 12\\n');
  process.exit(${options.execExit ?? 0});
}
const q = args[1] || '';
const data = {
  environment: { name: ${JSON.stringify(options.envName ?? 'staging')} },
  service: { name: 'Postgres' },
  sandbox: { status: 'RUNNING' },
  sandboxDestroy: true,
};
process.stdout.write(JSON.stringify({ data }));
`,
  );
  chmodSync(cli, 0o755);
  const execCalls = () =>
    calls().filter((c) => c[0] === 'sandbox' && c[1] === 'exec');
  const calls = () =>
    (existsSync(log) ? readFileSync(log, 'utf8') : '')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  return { calls, cli, execCalls, stdinFile };
}

function run(
  args: string[],
  env: Record<string, string>,
  input = '',
  cli = '',
) {
  // The fake `railway` sits first on PATH; with none given, one that refuses
  // everything does, so no test ever reaches the real Railway.
  let fake = cli;
  if (!fake) {
    fake = join(dir, 'refuse', 'railway');
    mkdirSync(dirname(fake), { recursive: true });
    writeFileSync(fake, '#!/bin/sh\necho "no Railway in tests" >&2\nexit 99\n');
    chmodSync(fake, 0o755);
  }
  return spawnSync(process.execPath, [script, ...args], {
    env: {
      PATH: `${dirname(fake)}:${process.env.PATH ?? ''}`,
      ...(args[0] === 'close' || args[0] === 'exec'
        ? { RAILWAY_ENVIRONMENT_ID: 'env-1', RAILWAY_PROJECT_ID: 'p-1' }
        : {}),
      ...env,
    },
    input,
  });
}

// @traces 1371-FR-002
describe('the command line', () => {
  it('exits 2 with a usage line on an unknown command and calls no Railway', () => {
    const f = fakeCli();
    const out = run(['destroy-everything'], {}, '', f.cli);
    expect(out.status).toBe(2);
    expect(out.stderr.toString()).toMatch(/usage/);
    expect(f.calls()).toEqual([]);
  });

  it('exits 2 on no command at all', () => {
    const f = fakeCli();
    expect(run([], {}, '', f.cli).status).toBe(2);
  });

  it('refuses a close with no sandbox id, with a usage line, and calls no Railway', () => {
    const f = fakeCli();
    for (const args of [['close'], ['close', '']]) {
      const out = run(args, { RAILWAY_API_TOKEN: 't' }, '', f.cli);
      expect(out.status).toBe(2);
      expect(out.stderr.toString()).toMatch(/usage/);
    }
    expect(f.calls()).toEqual([]);
  });

  it('destroys the named sandbox, passing the id as a variable and not inside the query', () => {
    const f = fakeCli();
    const id = 'sbx"}) { x } #';
    const out = run(['close', id], { RAILWAY_API_TOKEN: 't' }, '', f.cli);
    expect(out.status).toBe(0);
    const [call] = f.calls();
    expect(call?.[0]).toBe('api');
    expect(call?.[1]).not.toContain(id);
    expect(call?.join(' ')).toContain('sandboxDestroy');
    const at = call?.indexOf('--variables') ?? -1;
    expect(JSON.stringify(JSON.parse(call?.[at + 1] ?? '{}'))).toContain('sbx');
  });

  it('fails the close when Railway refuses to destroy, so the run is not silently green', () => {
    mkdirSync(join(dir, 'bad'));
    const cli = join(dir, 'bad', 'railway');
    writeFileSync(
      cli,
      '#!/bin/sh\necho \'{"data":null,"errors":[{"message":"Internal server error"}]}\'\nexit 1\n',
    );
    chmodSync(cli, 0o755);
    const out = run(['close', 'sbx-1'], { RAILWAY_API_TOKEN: 't' }, '', cli);
    expect(out.status).not.toBe(0);
    expect(out.stderr.toString()).toMatch(/Internal server error/);
  });

  it('refuses to open a staging sandbox when Railway names the environment production', () => {
    const f = fakeCli({ envName: 'production' });
    const out = run(
      ['open', 'staging', 'postgres'],
      {
        RAILWAY_API_TOKEN: 't',
        RAILWAY_ENVIRONMENT_ID: 'env-1',
        RAILWAY_SERVICE_POSTGRES: 'svc-1',
      },
      '',
      f.cli,
    );
    expect(out.status).not.toBe(0);
    expect(out.stdout.toString()).toBe('');
    expect(f.calls().some((c) => c.join(' ').includes('sandboxCreate'))).toBe(
      false,
    );
  });

  it('refuses an api sandbox in production before it calls Railway at all', () => {
    const f = fakeCli({ envName: 'production' });
    const out = run(
      ['open', 'production', 'api'],
      {
        RAILWAY_API_TOKEN: 't',
        RAILWAY_ENVIRONMENT_ID: 'env-1',
        RAILWAY_SERVICE_API: 'svc-1',
      },
      '',
      f.cli,
    );
    expect(out.status).not.toBe(0);
    expect(f.calls().some((c) => c.join(' ').includes('sandboxCreate'))).toBe(
      false,
    );
  });

  it.each([
    ['an unknown environment', ['open', 'qa', 'postgres']],
    ['an unknown kind', ['open', 'staging', 'redis']],
    ['no arguments', ['open']],
  ])('refuses open with %s and creates nothing', (_title, args) => {
    const f = fakeCli();
    const out = run(
      args,
      {
        RAILWAY_API_TOKEN: 't',
        RAILWAY_ENVIRONMENT_ID: 'env-1',
        RAILWAY_SERVICE_POSTGRES: 'svc-1',
      },
      '',
      f.cli,
    );
    expect(out.status).not.toBe(0);
    expect(out.stdout.toString()).toBe('');
    expect(f.calls().some((c) => c.join(' ').includes('sandboxCreate'))).toBe(
      false,
    );
  });

  it('refuses open when RAILWAY_ENVIRONMENT_ID is missing', () => {
    const f = fakeCli();
    const out = run(
      ['open', 'staging', 'postgres'],
      { RAILWAY_API_TOKEN: 't', RAILWAY_SERVICE_POSTGRES: 'svc-1' },
      '',
      f.cli,
    );
    expect(out.status).not.toBe(0);
    expect(out.stdout.toString()).toBe('');
  });

  it('exec streams stdin to the sandbox byte for byte and passes the exit code back', () => {
    const f = fakeCli({ execExit: 7 });
    const payload = `${'é€\n'.repeat(200_000)}end`;
    const out = run(
      ['exec', 'sbx-1'],
      { RAILWAY_API_TOKEN: 't' },
      payload,
      f.cli,
    );
    expect(out.status).toBe(7);
    expect(readFileSync(f.stdinFile, 'utf8')).toBe(payload);
    expect(out.stdout.toString()).toBe('BACKUP_SIZE 12\n');
  });

  it('exec puts the sandbox id after --id and runs sh -s when no command is given', () => {
    const f = fakeCli();
    run(['exec', 'sbx-1'], { RAILWAY_API_TOKEN: 't' }, 'true\n', f.cli);
    const [call] = f.execCalls();
    expect(call?.slice(0, 2)).toEqual(['sandbox', 'exec']);
    expect(call?.[call.indexOf('--id') + 1]).toBe('sbx-1');
    expect(call?.slice(-2)).toEqual(['sh', '-s']);
  });

  it('exec refuses a missing id and sends nothing', () => {
    const f = fakeCli();
    const out = run(['exec'], { RAILWAY_API_TOKEN: 't' }, 'x', f.cli);
    expect(out.status).not.toBe(0);
    expect(f.execCalls()).toEqual([]);
  });

  it('exec never carries the stdin payload or the token in its arguments', () => {
    const f = fakeCli();
    run(
      ['exec', 'sbx-1'],
      { RAILWAY_API_TOKEN: 'sekret-token-1' },
      'SECRET-PAYLOAD\n',
      f.cli,
    );
    const joined = f.calls().flat().join(' ');
    expect(joined).not.toContain('SECRET-PAYLOAD');
    expect(joined).not.toContain('sekret-token-1');
  });

  it('exec keeps a command with spaces and quotes as separate arguments after the separator', () => {
    const f = fakeCli();
    run(
      ['exec', 'sbx-1', 'echo', 'a b', "it's"],
      { RAILWAY_API_TOKEN: 't' },
      '',
      f.cli,
    );
    const [call] = f.execCalls();
    expect(call?.slice(call.indexOf('--') + 1)).toEqual([
      'echo',
      'a b',
      "it's",
    ]);
  });

  it('mask prints add-mask lines for the named secrets and nothing else', () => {
    const out = run(['mask', 'S1', 'S2'], { S1: 'pw-1', S2: '' });
    const text = out.stdout.toString();
    expect(out.status).toBe(0);
    expect(text).toContain('::add-mask::pw-1\n');
    expect(
      text
        .split('\n')
        .filter(Boolean)
        .every((l) => l.startsWith('::add-mask::')),
    ).toBe(true);
  });

  it('prelude fails naming an unset secret, prints no partial output and echoes no value', () => {
    const out = run(['prelude', 'GOOD', 'MISSING'], { GOOD: 'good-value-1' });
    expect(out.status).toBe(1);
    expect(out.stdout.toString()).toBe('');
    expect(out.stderr.toString()).toContain('MISSING');
    expect(out.stderr.toString()).not.toContain('good-value-1');
  });

  it('prelude on the command line prints the same text as the function', () => {
    const out = run(['prelude', 'A'], { A: 'héllo' });
    expect(out.stdout.toString()).toBe(prelude({ A: 'héllo' }, ['A']));
  });

  it('prints the usage and exits 2 for a command in the wrong case', () => {
    expect(run(['OPEN', 'staging', 'postgres'], {}).status).toBe(2);
  });
});
