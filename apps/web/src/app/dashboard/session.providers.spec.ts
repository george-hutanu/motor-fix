import { TestBed } from '@angular/core/testing';
import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { LEAVE, Session } from './session';

const DRIVER = {
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  role: 'driver',
} as unknown as MeDto;

function setup() {
  const api = {
    authControllerRefresh: jest.fn(() => Promise.reject(new Error('401'))),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
    oauthControllerComplete: jest.fn(() =>
      Promise.resolve({ accessToken: 'from-google' }),
    ),
    oauthControllerPending: jest.fn(() =>
      Promise.resolve({
        email: 'elena@example.test',
        name: 'Elena Pop',
        provider: 'google',
      }),
    ),
  };
  const leave = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MeService,
        useValue: { meControllerMe: jest.fn(async () => DRIVER) },
      },
      { provide: AuthService, useValue: api },
      { provide: LEAVE, useValue: leave },
    ],
  });
  return { api, leave, session: TestBed.inject(Session) };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('leaving for a provider', () => {
  it('goes to the start address with the language and the remember choice', async () => {
    const { leave, session } = setup();

    await session.leaveFor('google', { language: 'en', remember: false });

    expect(leave).toHaveBeenCalledWith(
      '/api/v1/auth/oauth/google?language=en&remember=false',
    );
    expect(sessionStorage.getItem('mf-return-to')).toBeNull();
  });

  it('keeps the screen to come back to when an action asked for the sign-in', async () => {
    const { leave, session } = setup();

    await session.leaveFor('apple', {
      language: 'ro',
      remember: true,
      returnTo: '/ro/garages/g-1',
    });

    expect(leave).toHaveBeenCalledWith(
      '/api/v1/auth/oauth/apple?language=ro&remember=true',
    );
    expect(sessionStorage.getItem('mf-return-to')).toBe('/ro/garages/g-1');
  });

  it('sends a sign-out still owed before it leaves, so it never ends the new session', async () => {
    const { api, leave, session } = setup();
    localStorage.setItem('mf-sign-out-pending', 'device');

    await session.leaveFor('google', { language: 'ro', remember: true });

    expect(api.authControllerSignOut).toHaveBeenCalled();
    expect(api.authControllerSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      leave.mock.invocationCallOrder[0],
    );
  });

  it('takes back only an address of this site', () => {
    const { session } = setup();
    sessionStorage.setItem('mf-return-to', '//evil.example/x');

    expect(session.takeReturnTo()).toBeNull();
    sessionStorage.setItem('mf-return-to', '/ro/garages');
    expect(session.takeReturnTo()).toBe('/ro/garages');
    expect(session.takeReturnTo()).toBeNull();
  });
});

describe('finishing a sign-up started with a provider', () => {
  it('reads what the provider gave', async () => {
    const { session } = setup();

    expect(await session.providerPending()).toEqual({
      email: 'elena@example.test',
      name: 'Elena Pop',
      provider: 'google',
    });
  });

  it('answers null when there is no sign-up to finish', async () => {
    const { api, session } = setup();
    api.oauthControllerPending.mockRejectedValueOnce(new Error('404'));

    expect(await session.providerPending()).toBeNull();
  });

  it('sends the name, the language and the consent to the current texts, then holds the session', async () => {
    const { api, session } = setup();

    const me = await session.completeProviderSignUp('Elena Pop', 'en');

    expect(api.oauthControllerComplete).toHaveBeenCalledWith({
      body: {
        consent: {
          privacyVersion: PRIVACY_VERSION,
          termsVersion: TERMS_VERSION,
        },
        language: 'en',
        name: 'Elena Pop',
      },
    });
    expect(session.token()).toBe('from-google');
    expect(me).toBe(DRIVER);
  });
});
