// @traces 456-FR-003
import {
  assertLoopback,
  CLEAR_STATEMENTS,
  clearActivityLog,
  ENSURE_ROLE,
  type Session,
} from './clear-activity-log.ts';

const LOCAL = 'postgresql://motorfix:motorfix@127.0.0.1:55432/motorfix';
const REFUSED = /not a database on this machine|DATABASE_URL unset/;

function fakeSession(
  opts: {
    failOn?: string | string[];
    failConnect?: boolean;
    failEnd?: boolean;
    failRollback?: boolean;
    thrown?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const failOn = [opts.failOn ?? []].flat();
  const session: Session = {
    connect: async () => {
      calls.push('connect');
      if (opts.failConnect) throw new Error('connect refused');
    },
    end: async () => {
      calls.push('end');
      if (opts.failEnd) throw new Error('end failed');
    },
    query: async (sql: string) => {
      calls.push(sql);
      if (sql === 'ROLLBACK' && opts.failRollback) {
        throw new Error('rollback failed');
      }
      if (failOn.includes(sql)) {
        throw opts.thrown ?? new Error(`refused: ${sql}`);
      }
      return {};
    },
  };
  return { calls, session };
}

describe('assertLoopback hostile hosts', () => {
  it.each([
    ['a suffix of localhost', 'postgresql://localhost.evil.com/db'],
    ['a prefix of 127.0.0.1', 'postgresql://127.0.0.1.evil.com/db'],
    ['localhost as the user name', 'postgresql://localhost@evil.com/db'],
    ['localhost:port as userinfo', 'postgresql://localhost:5432@evil.com/db'],
    [
      'loopback userinfo with a password',
      'postgresql://127.0.0.1:x@evil.com/db',
    ],
    ['a backslash before the at sign', 'postgresql://localhost\\@evil.com/db'],
    ['127.0.0.2', 'postgresql://127.0.0.2/db'],
    ['0.0.0.0', 'postgresql://0.0.0.0/db'],
    ['the unspecified IPv6 address', 'postgresql://[::]/db'],
    ['an IPv4-mapped IPv6 address', 'postgresql://[::ffff:7f00:1]/db'],
    ['a remote IPv6 address', 'postgresql://[2001:db8::1]/db'],
    ['fullwidth localhost', 'postgresql://ｌｏｃａｌｈｏｓｔ/db'],
    ['two hosts, loopback first', 'postgresql://localhost,evil.com/db'],
    ['two hosts with ports', 'postgresql://localhost:5432,evil.com:5432/db'],
    ['two hosts, loopback last', 'postgresql://evil.com,localhost/db'],
    [
      'an encoded unix socket path',
      'postgresql://%2Fvar%2Frun%2Fpostgresql/db',
    ],
    [
      'a socket directory in host=',
      'postgresql://localhost/db?host=/var/run/postgresql',
    ],
    ['an empty host= value', 'postgresql://localhost/db?host='],
    ['an empty hostaddr= value', 'postgresql://localhost/db?hostaddr='],
    [
      'a percent-encoded host parameter name',
      'postgresql://localhost/db?ho%73t=evil.com',
    ],
    [
      'a percent-encoded hostaddr name',
      'postgresql://localhost/db?hostadd%72=10.0.0.5',
    ],
    [
      'host after other parameters',
      'postgresql://localhost/db?sslmode=disable&host=evil.com',
    ],
    [
      'hostaddr with a fragment trick',
      'postgresql://localhost/db?a=1&hostaddr=10.0.0.5#x',
    ],
    ['a remote scheme-less host', 'evil.com/db'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['file scheme with no host', 'file:///tmp/pg.sock'],
    ['an unparseable string', 'not a url'],
    ['a leading space before a remote url', ' postgresql://evil.com/db'],
    ['a remote host with a loopback path', 'postgresql://evil.com/localhost'],
    [
      'a remote host with a loopback query value',
      'postgresql://evil.com/db?x=localhost',
    ],
  ])('refuses %s', (_, url) => {
    expect(() => assertLoopback(url)).toThrow();
  });

  it.each([
    ['postgresql://evil.com/db'],
    ['postgresql://127.0.0.2/db'],
    ['postgresql://localhost,evil.com/db'],
  ])('names the refusal for %s', (url) => {
    expect(() => assertLoopback(url)).toThrow(REFUSED);
  });

  it('refuses an empty DATABASE_URL like an unset one', () => {
    expect(() => assertLoopback('')).toThrow(REFUSED);
  });
});

describe('assertLoopback legitimate hosts', () => {
  it.each([
    'postgresql://evil.com@localhost/db',
    'postgresql://evil.com:pw@127.0.0.1:5432/db',
    'postgres://localhost/db',
    'postgresql://localhost/db?sslmode=disable',
    'postgresql://[::1]/db',
    'postgresql://[::1]:65535/db',
    'postgresql://localhost:1/db',
    'postgresql://u:p%40ss@localhost/db',
    'postgresql://localhost',
  ])('accepts %s and returns it unchanged', (url) => {
    expect(assertLoopback(url)).toBe(url);
  });

  it('accepts an upper-case LOCALHOST, which is the same loopback host', () => {
    const url = 'postgresql://u:p@LOCALHOST:5432/db';
    expect(assertLoopback(url)).toBe(url);
  });

  it('gives the same answer when called twice', () => {
    expect(assertLoopback(LOCAL)).toBe(assertLoopback(LOCAL));
    expect(() => assertLoopback('postgresql://evil.com/db')).toThrow();
    expect(() => assertLoopback('postgresql://evil.com/db')).toThrow();
  });
});

describe('clearActivityLog before connecting', () => {
  it.each([
    ['unset', {}],
    ['empty', { DATABASE_URL: '' }],
    [
      'remote with PGHOST pointing home',
      { DATABASE_URL: 'postgresql://evil.com/db', PGHOST: 'localhost' },
    ],
    ['unset with PGHOST local', { PGHOST: 'localhost' }],
    ['socket host', { DATABASE_URL: 'postgresql://localhost/db?host=/tmp' }],
    ['userinfo trick', { DATABASE_URL: 'postgresql://localhost@evil.com/db' }],
  ])('never opens a session for a %s URL', async (_, source) => {
    const open = jest.fn();
    await expect(clearActivityLog(source, open)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens exactly one session with the URL it was given', async () => {
    const { session } = fakeSession();
    const open = jest.fn(() => session);
    await clearActivityLog({ DATABASE_URL: LOCAL }, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(LOCAL);
  });

  it('rejects, not throws, when the opener throws', async () => {
    const promise = clearActivityLog({ DATABASE_URL: LOCAL }, () => {
      throw new Error('no driver');
    });
    await expect(promise).rejects.toThrow('no driver');
  });
});

describe('clearActivityLog error paths', () => {
  it('passes a connect failure on and sends no statement', async () => {
    const { calls, session } = fakeSession({ failConnect: true });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow('connect refused');
    expect(calls).not.toContain(ENSURE_ROLE);
    expect(calls).not.toContain('BEGIN');
    expect(calls).not.toContain('COMMIT');
    expect(calls.filter((c) => c === 'end').length).toBeLessThanOrEqual(1);
  });

  it('closes once and runs no transaction when the role cannot be made', async () => {
    const { calls, session } = fakeSession({ failOn: ENSURE_ROLE });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow(/refused/);
    expect(calls.filter((c) => c === 'end')).toHaveLength(1);
    expect(calls).not.toContain('TRUNCATE TABLE activity_log');
    expect(calls).not.toContain('COMMIT');
  });

  it.each(CLEAR_STATEMENTS.filter((s) => s !== 'BEGIN' && s !== 'COMMIT'))(
    'rolls back, never commits and closes once when %s fails',
    async (statement) => {
      const { calls, session } = fakeSession({ failOn: statement });
      await expect(
        clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
      ).rejects.toThrow(`refused: ${statement}`);
      expect(calls).not.toContain('COMMIT');
      expect(calls).toContain('ROLLBACK');
      expect(calls.filter((c) => c === 'end')).toHaveLength(1);
      expect(calls[calls.length - 1]).toBe('end');
    },
  );

  it('stops at the first failing statement', async () => {
    const { calls, session } = fakeSession({
      failOn: 'SET LOCAL ROLE motorfix_migrator',
    });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow();
    expect(calls).not.toContain('TRUNCATE TABLE activity_log');
  });

  it('rolls back when COMMIT itself is refused', async () => {
    const { calls, session } = fakeSession({ failOn: 'COMMIT' });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow('refused: COMMIT');
    expect(calls.filter((c) => c === 'end')).toHaveLength(1);
    expect(calls).toContain('ROLLBACK');
  });

  it('keeps the original error and still closes when ROLLBACK fails too', async () => {
    const { calls, session } = fakeSession({
      failOn: 'TRUNCATE TABLE activity_log',
      failRollback: true,
    });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow('refused: TRUNCATE TABLE activity_log');
    expect(calls.filter((c) => c === 'end')).toHaveLength(1);
  });

  it('keeps the original error when closing fails after a failure', async () => {
    const { session } = fakeSession({
      failEnd: true,
      failOn: 'TRUNCATE TABLE activity_log',
    });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow('refused: TRUNCATE TABLE activity_log');
  });

  it('fails loudly when closing fails after a clean run', async () => {
    const { session } = fakeSession({ failEnd: true });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toThrow('end failed');
  });

  it('passes a non-Error rejection through unchanged', async () => {
    const { session } = fakeSession({
      failOn: 'TRUNCATE TABLE activity_log',
      thrown: 'plain string',
    });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => session),
    ).rejects.toBe('plain string');
  });

  it('closes exactly once on success', async () => {
    const { calls, session } = fakeSession();
    await clearActivityLog({ DATABASE_URL: LOCAL }, () => session);
    expect(calls.filter((c) => c === 'end')).toHaveLength(1);
    expect(calls.filter((c) => c === 'connect')).toHaveLength(1);
    expect(calls).not.toContain('ROLLBACK');
  });

  it('sends the same statements on a second run', async () => {
    const first = fakeSession();
    const second = fakeSession();
    await clearActivityLog({ DATABASE_URL: LOCAL }, () => first.session);
    await clearActivityLog({ DATABASE_URL: LOCAL }, () => second.session);
    expect(second.calls).toEqual(first.calls);
  });

  it('keeps going after one failed run in the same process', async () => {
    const bad = fakeSession({ failOn: ENSURE_ROLE });
    await expect(
      clearActivityLog({ DATABASE_URL: LOCAL }, () => bad.session),
    ).rejects.toThrow();
    const good = fakeSession();
    await clearActivityLog({ DATABASE_URL: LOCAL }, () => good.session);
    expect(good.calls).toEqual([
      'connect',
      ENSURE_ROLE,
      ...CLEAR_STATEMENTS,
      'end',
    ]);
  });
});

describe('the statements themselves', () => {
  it('empty exactly one table and commit last', () => {
    expect(CLEAR_STATEMENTS.filter((s) => /TRUNCATE/i.test(s))).toEqual([
      'TRUNCATE TABLE activity_log',
    ]);
    expect(CLEAR_STATEMENTS[0]).toBe('BEGIN');
    expect(CLEAR_STATEMENTS[CLEAR_STATEMENTS.length - 1]).toBe('COMMIT');
  });

  it('use only transaction-local settings, never a session-wide one', () => {
    const sets = CLEAR_STATEMENTS.filter((s) => /^SET\b/i.test(s));
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) expect(s).toMatch(/^SET LOCAL /);
    expect(CLEAR_STATEMENTS.join('\n')).not.toMatch(
      /\bRESET\b|SET SESSION|CASCADE/i,
    );
  });

  it('grant the role nothing beyond the two rights', () => {
    const grants = ENSURE_ROLE.match(/GRANT [^;]*;/g) ?? [];
    expect(grants).toHaveLength(2);
    expect(ENSURE_ROLE).not.toMatch(/\bLOGIN\b(?<!NOLOGIN)/);
    expect(ENSURE_ROLE).not.toMatch(
      /ALL PRIVILEGES|WITH GRANT OPTION|CREATEROLE|BYPASSRLS|DROP|ALTER ROLE/i,
    );
  });
});
