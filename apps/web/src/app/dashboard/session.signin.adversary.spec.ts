import type { MeDto } from '@motor-fix/data-access';

import { account, setup } from './signed-in.testing';

const andrei = account();

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, reject, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

function concurrentSetup() {
  const { auth, me, session } = setup({
    auth: {
      authControllerRefresh: jest.fn(() =>
        Promise.resolve({ accessToken: 'renewed' } as { accessToken?: string }),
      ),
      authControllerSignIn: jest.fn(() =>
        Promise.resolve({ accessToken: 'signed-in' }),
      ),
    },
    me: { meControllerMe: jest.fn(() => Promise.resolve(andrei)) },
  });
  return { api: auth, me: me.meControllerMe, session };
}

beforeEach(() => localStorage.clear());

describe('Session under concurrent and failing calls', () => {
  it('asks for the renewal and the account once when several callers load at the same moment', async () => {
    const { api, me, session } = concurrentSetup();

    const all = await Promise.all([
      session.load(),
      session.load(),
      session.load(),
    ]);

    expect(all.map((a) => a?.id)).toEqual([
      'account-1',
      'account-1',
      'account-1',
    ]);
    expect(api.authControllerRefresh).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('does not renew again when a token is already held', async () => {
    const { api, session } = concurrentSetup();
    await session.signIn('a@b.ro', 'x', true);

    await session.load();

    expect(api.authControllerRefresh).not.toHaveBeenCalled();
  });

  it('does not keep a token when the renewal answers without one', async () => {
    const { api, session } = concurrentSetup();
    api.authControllerRefresh.mockResolvedValueOnce({});

    const ok = await session.renew();

    expect(ok).toBe(false);
    expect(session.token()).toBeNull();
  });

  it.each([
    ['a server error', Object.assign(new Error('500'), { status: 500 })],
    ['a network failure', Object.assign(new Error('offline'), { status: 0 })],
    ['a thrown string', 'boom'],
  ])(
    'answers false and holds no token when the renewal fails with %s',
    async (_, failure) => {
      const { api, session } = concurrentSetup();
      await session.signIn('a@b.ro', 'x', true);
      api.authControllerRefresh.mockRejectedValueOnce(failure);

      await expect(session.renew()).resolves.toBe(false);

      expect(session.token()).toBeNull();
      expect(session.current()).toBeNull();
    },
  );

  it('lets the next renewal run after a failed one', async () => {
    const { api, session } = concurrentSetup();
    api.authControllerRefresh.mockRejectedValueOnce(new Error('401'));

    await expect(session.renew()).resolves.toBe(false);
    await expect(session.renew()).resolves.toBe(true);

    expect(session.token()).toBe('renewed');
  });

  it('does not bring the session back when a renewal that was already on its way finishes after sign-out', async () => {
    const { api, session } = concurrentSetup();
    await session.signIn('a@b.ro', 'x', true);
    const late = deferred<{ accessToken: string }>();
    api.authControllerRefresh.mockReturnValueOnce(late.promise);
    const renewing = session.renew();

    await session.signOut();
    late.resolve({ accessToken: 'resurrected' });
    await renewing;
    await flush();

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });

  it('does not show the account when the account request finishes after sign-out', async () => {
    const { me, session } = concurrentSetup();
    const late = deferred<MeDto>();
    me.mockReturnValueOnce(late.promise);
    const loading = session.load();
    await flush();

    await session.signOut();
    late.resolve(andrei);
    await loading;
    await flush();

    expect(session.current()).toBeNull();
    expect(session.token()).toBeNull();
  });

  it('signs out twice in a row, and while signed out', async () => {
    const { api, session } = concurrentSetup();

    await session.signOut();
    await session.signOut();

    expect(api.authControllerSignOut).toHaveBeenCalledTimes(2);
    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });

  it('answers no account, and shows none, when the sign-in succeeds but the account request fails', async () => {
    const { me, session } = concurrentSetup();
    me.mockRejectedValueOnce(new Error('500'));

    await expect(session.signIn('a@b.ro', 'x', true)).resolves.toBeNull();

    expect(session.current()).toBeNull();
  });

  it('sends the password exactly as typed, including surrounding spaces', async () => {
    const { api, session } = concurrentSetup();

    await session.signIn('a@b.ro', '  spaced  ', false);

    expect(api.authControllerSignIn).toHaveBeenCalledWith({
      body: { email: 'a@b.ro', password: '  spaced  ', remember: false },
    });
  });

  it('keeps the token of a second sign-in when two are made in a row', async () => {
    const { api, session } = concurrentSetup();
    api.authControllerSignIn
      .mockResolvedValueOnce({ accessToken: 'first' })
      .mockResolvedValueOnce({ accessToken: 'second' });

    await session.signIn('a@b.ro', 'x', true);
    await session.signIn('a@b.ro', 'x', true);

    expect(session.token()).toBe('second');
  });
});
