// @traces 878-FR-001
import { applyMonitorPassword, type Session } from './monitor-password.ts';

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

  it('sets the role password as an escaped literal and closes the session', async () => {
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
    expect(calls).toEqual([
      'connect',
      "ALTER ROLE motorfix_monitor PASSWORD 'it''s-secret'",
      'end',
    ]);
    expect(message).toBe('monitor password: applied');
    expect(message).not.toContain('secret');
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
