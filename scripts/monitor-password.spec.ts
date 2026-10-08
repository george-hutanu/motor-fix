// @traces 878-FR-001
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';

import { applyMonitorPassword, type Session } from './monitor-password.ts';

const VERIFIER =
  /^ALTER ROLE motorfix_monitor PASSWORD 'SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)'$/;

// RFC 5802 / 7677: what PostgreSQL stores for a SCRAM-SHA-256 password.
function keysFor(password: string, salt: Buffer) {
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const hmac = (text: string) =>
    createHmac('sha256', salted).update(text).digest();
  return {
    server: hmac('Server Key').toString('base64'),
    stored: createHash('sha256')
      .update(hmac('Client Key'))
      .digest()
      .toString('base64'),
  };
}

function fakeSession() {
  const calls: string[] = [];
  const session: Session = {
    connect: async () => {
      calls.push('connect');
    },
    end: async () => {
      calls.push('end');
    },
    query: async (sql: string) => {
      calls.push(sql);
      return {};
    },
  };
  return { calls, session };
}

describe('applyMonitorPassword', () => {
  it('skips without connecting when MONITOR_DATABASE_PASSWORD is unset', async () => {
    const open = jest.fn();

    await expect(
      applyMonitorPassword({ DATABASE_URL: 'postgresql://x/y' }, open),
    ).resolves.toBe(
      'monitor password: MONITOR_DATABASE_PASSWORD unset, skipped',
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('treats an empty password as unset', async () => {
    const open = jest.fn();

    await applyMonitorPassword(
      { DATABASE_URL: 'postgresql://x/y', MONITOR_DATABASE_PASSWORD: '' },
      open,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('sends only a SCRAM-SHA-256 verifier, never the password, and closes the session', async () => {
    const { calls, session } = fakeSession();
    const open = jest.fn(() => session);

    const message = await applyMonitorPassword(
      {
        DATABASE_URL: 'postgresql://admin@db/motorfix',
        MONITOR_DATABASE_PASSWORD: "it's-secret",
      },
      open,
    );

    expect(open).toHaveBeenCalledWith('postgresql://admin@db/motorfix');
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe('connect');
    expect(calls[2]).toBe('end');
    const statement = calls[1] ?? '';
    expect(statement).not.toContain('secret');
    const [, salt = '', stored, server] = VERIFIER.exec(statement) ?? [];
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect({ server, stored }).toEqual(
      keysFor("it's-secret", Buffer.from(salt, 'base64')),
    );
    expect(message).toBe('monitor password: applied');
    expect(message).not.toContain('secret');
  });

  it('salts each verifier afresh', async () => {
    const statements: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { calls, session } = fakeSession();
      await applyMonitorPassword(
        { DATABASE_URL: 'postgresql://x/y', MONITOR_DATABASE_PASSWORD: 'p' },
        () => session,
      );
      statements.push(calls[1] ?? '');
    }
    expect(statements[0]).not.toBe(statements[1]);
  });

  it('closes the session and rethrows when the statement fails', async () => {
    const { calls, session } = fakeSession();
    const refused = new Error('role "motorfix_monitor" does not exist');
    session.query = async () => {
      throw refused;
    };

    await expect(
      applyMonitorPassword(
        { DATABASE_URL: 'postgresql://x/y', MONITOR_DATABASE_PASSWORD: 'p' },
        () => session,
      ),
    ).rejects.toBe(refused);
    expect(calls).toEqual(['connect', 'end']);
  });

  it('refuses a set password with no DATABASE_URL', async () => {
    await expect(
      applyMonitorPassword({ MONITOR_DATABASE_PASSWORD: 'p' }, jest.fn()),
    ).rejects.toThrow('DATABASE_URL');
  });
});
