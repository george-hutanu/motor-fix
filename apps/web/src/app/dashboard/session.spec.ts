import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

function account(language: 'ro' | 'en') {
  return {
    capabilities: [],
    email: 'andrei@example.ro',
    garageAccess: [],
    garageId: null,
    id: 'account-1',
    landing: '/app/driver',
    language,
    name: 'Andrei',
    role: 'driver',
    roles: ['driver'],
  } as unknown as MeDto;
}

const refused = () => Promise.reject(new Error('401'));

function setup({
  me = account('ro') as MeDto | null,
  renews = true,
}: {
  me?: MeDto | null;
  renews?: boolean;
} = {}) {
  let tokens = 0;
  const api = {
    authControllerRefresh: jest.fn(() =>
      renews
        ? Promise.resolve({ accessToken: `renewed-${++tokens}` })
        : refused(),
    ),
    authControllerSignIn: jest.fn(() =>
      Promise.resolve({ accessToken: 'signed-in' }),
    ),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
    passwordResetControllerComplete: jest.fn(() =>
      Promise.resolve({ accessToken: 'reset' }),
    ),
  };
  const meControllerMe = jest.fn(() => (me ? Promise.resolve(me) : refused()));
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      { provide: AuthService, useValue: api },
    ],
  });
  return {
    api,
    i18n: TestBed.inject(I18n),
    meControllerMe,
    session: TestBed.inject(Session),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => localStorage.clear());

describe('Session', () => {
  it("switches to the account's language when the session loads, and remembers it", async () => {
    localStorage.setItem('mf.lang', 'ro');
    const { i18n, session } = setup({ me: account('en') });

    await session.load();
    await flush();

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  // A public page whose address names its language (/en/garages/…) keeps it.
  it("keeps the page's language when asked, on a load that only reads the role", async () => {
    localStorage.setItem('mf.lang', 'ro');
    const { i18n, session } = setup({ me: account('en') });

    const me = await session.load({ keepLanguage: true });
    await flush();

    expect(me?.role).toBe('driver');
    expect(session.current()?.role).toBe('driver');
    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBe('ro');
  });

  it('lets a tap made while signed in stand on the next load', async () => {
    const { i18n, session } = setup({ me: account('en') });
    await session.load();
    await flush();

    await TestBed.inject(LanguageChoice).choose('ro');
    await session.load();
    await flush();

    expect(i18n.language()).toBe('ro');
  });

  it('changes nothing when nobody is signed in', async () => {
    const { i18n, session } = setup({ me: null, renews: false });

    expect(await session.load()).toBeNull();

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBeNull();
  });
});

describe('Session tokens', () => {
  it('renews from the cookie before asking who is signed in, when it holds no token', async () => {
    const { api, meControllerMe, session } = setup();

    const me = await session.load();

    expect(me?.id).toBe('account-1');
    expect(api.authControllerRefresh).toHaveBeenCalledTimes(1);
    expect(api.authControllerRefresh.mock.invocationCallOrder[0]).toBeLessThan(
      meControllerMe.mock.invocationCallOrder[0] ?? 0,
    );
    expect(session.token()).toBe('renewed-1');
  });

  it('does not ask who is signed in when the renewal fails', async () => {
    const { meControllerMe, session } = setup({ renews: false });

    expect(await session.load()).toBeNull();

    expect(meControllerMe).not.toHaveBeenCalled();
    expect(session.token()).toBeNull();
  });

  it('signs in with the e-mail, the password and "keep me signed in", then loads the account', async () => {
    const { api, session } = setup();

    const me = await session.signIn('andrei@example.ro', 'parola', false);

    expect(api.authControllerSignIn).toHaveBeenCalledWith({
      body: { email: 'andrei@example.ro', password: 'parola', remember: false },
    });
    expect(api.authControllerRefresh).not.toHaveBeenCalled();
    expect(session.token()).toBe('signed-in');
    expect(me?.landing).toBe('/app/driver');
    expect(session.current()).toBe(me);
  });

  it('starts the session a completed password reset answers with', async () => {
    const { api, session } = setup();

    const me = await session.resetPassword('the-token', 'parola-noua');

    expect(api.passwordResetControllerComplete).toHaveBeenCalledWith({
      body: { password: 'parola-noua', token: 'the-token' },
    });
    expect(session.token()).toBe('reset');
    expect(me?.landing).toBe('/app/driver');
    expect(session.current()).toBe(me);
  });

  it('lets a refused password reset reach the caller, holding no token', async () => {
    const { api, session } = setup();
    api.passwordResetControllerComplete.mockImplementationOnce(refused);

    await expect(session.resetPassword('t', 'parola-noua')).rejects.toThrow(
      '401',
    );
    expect(session.token()).toBeNull();
  });

  it('lets a failed sign-in reach the caller, holding no token', async () => {
    const { api, session } = setup();
    api.authControllerSignIn.mockImplementationOnce(refused);

    await expect(session.signIn('a@b.ro', 'x', true)).rejects.toThrow('401');
    expect(session.token()).toBeNull();
  });

  it('shares one renewal between callers that ask at once', async () => {
    const { api, session } = setup();

    const results = await Promise.all([session.renew(), session.renew()]);

    expect(results).toEqual([true, true]);
    expect(api.authControllerRefresh).toHaveBeenCalledTimes(1);
    expect(await session.renew()).toBe(true);
    expect(api.authControllerRefresh).toHaveBeenCalledTimes(2);
    expect(session.token()).toBe('renewed-2');
  });

  it('forgets the token and the account when a renewal fails', async () => {
    const { api, session } = setup();
    await session.load();
    api.authControllerRefresh.mockImplementationOnce(refused);

    expect(await session.renew()).toBe(false);

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });

  it('signs out on the server and forgets the session', async () => {
    const { api, session } = setup();
    await session.load();

    await session.signOut();

    expect(api.authControllerSignOut).toHaveBeenCalledTimes(1);
    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });

  it('signs in again cleanly after a sign-out made while a load was on its way', async () => {
    const { meControllerMe, session } = setup();
    let answerLate: (me: MeDto) => void = () => undefined;
    meControllerMe.mockImplementationOnce(
      () =>
        new Promise<MeDto>((resolve) => {
          answerLate = resolve;
        }),
    );
    const stale = session.load();
    await flush();

    await session.signOut();
    const me = await session.signIn('andrei@example.ro', 'parola', true);
    answerLate(account('ro'));

    expect(await stale).toBeNull();
    expect(me?.id).toBe('account-1');
    expect(session.current()?.id).toBe('account-1');
    expect(session.token()).toBe('signed-in');
  });

  it('forgets the session even when the sign-out call fails', async () => {
    const { api, session } = setup();
    await session.load();
    api.authControllerSignOut.mockImplementationOnce(refused);

    await session.signOut();

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });
});
