import {
  createInput,
  maskLines,
  prelude,
  type Run,
  railwayApi,
  references,
  refusal,
  waitRunning,
} from './railway-sandbox.ts';

// The helper's pure parts. Railway itself is never called: `railwayApi` runs
// the CLI through the `run` it is given, and the specs hand it a fake.

// A Railway reference variable, resolved by Railway when the sandbox starts.
const ref = (service: string, name: string) => `\${{${service}.${name}}}`;

// @traces 1371-workflows-no-ssh-FR-003
describe('references', () => {
  it('gives a PostgreSQL sandbox the connection and environment name of the named service, as references only', () => {
    expect(references('postgres', 'Postgres')).toEqual({
      PGDATABASE: ref('Postgres', 'PGDATABASE'),
      PGHOST: ref('Postgres', 'PGHOST'),
      PGPASSWORD: ref('Postgres', 'PGPASSWORD'),
      PGPORT: ref('Postgres', 'PGPORT'),
      PGUSER: ref('Postgres', 'PGUSER'),
      RAILWAY_ENVIRONMENT_NAME: ref('Postgres', 'RAILWAY_ENVIRONMENT_NAME'),
    });
  });

  it("gives an api sandbox the api's database address, app environment and Railway environment name", () => {
    expect(references('api', 'api')).toEqual({
      APP_ENV: ref('api', 'APP_ENV'),
      DATABASE_URL: ref('api', 'DATABASE_URL'),
      RAILWAY_ENVIRONMENT_NAME: ref('api', 'RAILWAY_ENVIRONMENT_NAME'),
    });
  });

  it('refuses a service name a reference cannot hold', () => {
    expect(() => references('postgres', 'Post}}gres')).toThrow(/service name/);
    expect(() => references('postgres', '')).toThrow(/service name/);
  });
});

// @traces 1371-workflows-no-ssh-FR-003
describe('createInput', () => {
  const input = createInput('env-1', 'postgres', 'Postgres');

  it('opens on the private network, in the services region, with an idle backstop', () => {
    expect(input).toMatchObject({
      environmentId: 'env-1',
      idleTimeoutMinutes: 30,
      networkIsolation: 'PRIVATE',
      region: 'europe-west4-drams3a',
    });
  });

  it('asks for no public domain and carries only references', () => {
    expect(input).not.toHaveProperty('publicDomains');
    for (const value of Object.values(input.variables)) {
      expect(value).toMatch(/^\$\{\{Postgres\.[A-Z_]+\}\}$/);
    }
  });
});

// @traces 1371-workflows-no-ssh-FR-002
describe('refusal', () => {
  it('lets a sandbox open in the environment the job names', () => {
    expect(refusal('staging', 'postgres', 'staging')).toBeUndefined();
    expect(refusal('staging', 'api', 'staging')).toBeUndefined();
    expect(refusal('production', 'postgres', 'production')).toBeUndefined();
  });

  it('refuses when the environment id belongs to another environment', () => {
    expect(refusal('staging', 'postgres', 'production')).toMatch(
      /production.*not.*staging|not.*staging.*production/,
    );
    expect(refusal('production', 'postgres', 'staging')).toBeDefined();
  });

  it('refuses an api sandbox anywhere but staging', () => {
    expect(refusal('production', 'api', 'production')).toMatch(/staging/);
  });

  it('refuses an unknown kind or environment', () => {
    expect(refusal('staging', 'redis', 'staging')).toMatch(/kind/);
    expect(refusal('', 'postgres', '')).toBeDefined();
  });
});

// @traces 1371-workflows-no-ssh-FR-004
describe('prelude', () => {
  const env = {
    PASS: 'it\'s $(rm -rf /) "quoted"\nsecond line',
    PLAIN: 'staging',
  };

  it('hands each value over base64, so no quoting can break it, and exports it', () => {
    const text = prelude(env, ['PASS', 'PLAIN']);

    expect(text).not.toContain('rm -rf');
    expect(text).not.toContain('second line');
    for (const [name, value] of Object.entries(env)) {
      const encoded = Buffer.from(value).toString('base64');
      expect(text).toContain(
        `${name}=$(printf %s '${encoded}' | base64 -d); export ${name}\n`,
      );
    }
  });

  it('refuses a name that is unset or empty, naming it', () => {
    expect(() => prelude({ A: '' }, ['A'])).toThrow(/A/);
    expect(() => prelude({}, ['MISSING'])).toThrow(/MISSING/);
  });

  it('refuses a name a shell could not assign', () => {
    expect(() => prelude({ 'A;B': 'x' }, ['A;B'])).toThrow();
  });
});

// @traces 1371-workflows-no-ssh-FR-004
describe('maskLines', () => {
  it('masks the raw value, its base64 form and every line of a multi-line value', () => {
    const lines = maskLines({ KEY: 'one\ntwo' }, ['KEY']);

    expect(lines).toEqual(
      expect.arrayContaining([
        '::add-mask::one',
        '::add-mask::two',
        `::add-mask::${Buffer.from('one\ntwo').toString('base64')}`,
      ]),
    );
  });

  it('skips a name with no value, so an unset optional secret prints nothing', () => {
    expect(maskLines({ A: '' }, ['A', 'B'])).toEqual([]);
  });
});

// @traces 1371-workflows-no-ssh-FR-002
describe('railwayApi', () => {
  const refused = JSON.stringify({
    data: null,
    errors: [{ message: 'Not Authorized' }],
  });
  const answer = JSON.stringify({ data: { environment: { name: 'staging' } } });

  function fake(answers: string[]) {
    const calls: { args: string[]; env: Record<string, string | undefined> }[] =
      [];
    const run: Run = (args, env) => {
      calls.push({ args, env });
      const stdout = answers.shift() ?? '';
      return {
        status: stdout.includes('"errors"') ? 1 : 0,
        stderr: '',
        stdout,
      };
    };
    return { calls, run };
  }

  it('sends the token as a bearer first', () => {
    const { calls, run } = fake([answer]);
    const ctx = { env: { RAILWAY_API_TOKEN: 'tok' }, run };

    expect(railwayApi('query { x }', { e: 'env-1' }, ctx)).toEqual({
      environment: { name: 'staging' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(0, 2)).toEqual(['api', 'query { x }']);
    expect(calls[0]?.env.RAILWAY_API_TOKEN).toBe('tok');
    expect(calls[0]?.env.RAILWAY_TOKEN).toBeUndefined();
  });

  it('retries once as a project token when Railway refuses the bearer, and keeps to it', () => {
    const { calls, run } = fake([refused, answer, answer]);
    const ctx: Parameters<typeof railwayApi>[2] = {
      env: { RAILWAY_API_TOKEN: 'tok' },
      run,
    };

    railwayApi('query { x }', {}, ctx);
    railwayApi('query { y }', {}, ctx);

    expect(calls).toHaveLength(3);
    expect(calls[1]?.env.RAILWAY_TOKEN).toBe('tok');
    expect(calls[1]?.env.RAILWAY_API_TOKEN).toBeUndefined();
    expect(calls[2]?.env.RAILWAY_TOKEN).toBe('tok');
    expect(ctx.kind).toBe('project');
  });

  it("fails with Railway's message, never the token, when both are refused", () => {
    const { run } = fake([refused, refused]);
    const ctx = { env: { RAILWAY_API_TOKEN: 'sekret-token' }, run };

    expect(() => railwayApi('query { x }', {}, ctx)).toThrow(/Not Authorized/);
    try {
      railwayApi(
        'query { x }',
        {},
        { ...ctx, run: fake([refused, refused]).run },
      );
    } catch (error) {
      expect(String(error)).not.toContain('sekret-token');
    }
  });

  it('does not retry an error that is not a refusal', () => {
    const { calls, run } = fake([
      JSON.stringify({
        data: null,
        errors: [{ message: 'Sandbox not found' }],
      }),
    ]);

    expect(() =>
      railwayApi('query { x }', {}, { env: { RAILWAY_API_TOKEN: 't' }, run }),
    ).toThrow(/Sandbox not found/);
    expect(calls).toHaveLength(1);
  });

  it('goes straight to a project token when RAILWAY_TOKEN_KIND says so', () => {
    const { calls, run } = fake([answer]);

    railwayApi(
      'query { x }',
      {},
      { env: { RAILWAY_API_TOKEN: 't', RAILWAY_TOKEN_KIND: 'project' }, run },
    );
    expect(calls[0]?.env.RAILWAY_TOKEN).toBe('t');
  });

  it("uses the CLI's own login when no token is given, retrying nothing", () => {
    const { calls, run } = fake([refused, answer]);

    expect(() =>
      railwayApi('query { x }', {}, { env: { HOME: '/home/me' }, run }),
    ).toThrow(/Not Authorized/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.env).toEqual({ HOME: '/home/me' });
  });
});

// @traces 1371-workflows-no-ssh-FR-002
describe('waitRunning', () => {
  function clock(states: string[]) {
    let t = 0;
    return {
      now: () => t,
      read: () => states.shift() ?? 'CREATING',
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  it('returns once the sandbox is RUNNING', async () => {
    const c = clock(['CREATING', 'CREATING', 'RUNNING']);
    await expect(
      waitRunning(c.read, {
        limitMs: 60_000,
        now: c.now,
        pollMs: 5_000,
        sleep: c.sleep,
      }),
    ).resolves.toBeUndefined();
    expect(c.now()).toBe(10_000);
  });

  it('fails at once on a state that never becomes RUNNING', async () => {
    const c = clock(['CREATING', 'FAILED']);
    await expect(
      waitRunning(c.read, {
        limitMs: 60_000,
        now: c.now,
        pollMs: 5_000,
        sleep: c.sleep,
      }),
    ).rejects.toThrow(/FAILED/);
  });

  it('fails past the bound with the state it last saw', async () => {
    const c = clock([]);
    await expect(
      waitRunning(c.read, {
        limitMs: 20_000,
        now: c.now,
        pollMs: 5_000,
        sleep: c.sleep,
      }),
    ).rejects.toThrow(/CREATING.*20 s|20 s.*CREATING/);
  });
});
