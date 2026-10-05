import { TestBed } from '@angular/core/testing';
import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const DRIVER = {
  capabilities: [],
  email: 'andrei@example.ro',
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei Marin',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

function setup() {
  const api = {
    authControllerRefresh: jest.fn(() => Promise.reject(new Error('401'))),
    authControllerSignUp: jest.fn(() =>
      Promise.resolve({ accessToken: 'signed-up' }),
    ),
  };
  const meControllerMe = jest.fn(() => Promise.resolve(DRIVER));
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      { provide: AuthService, useValue: api },
    ],
  });
  return { api, meControllerMe, session: TestBed.inject(Session) };
}

beforeEach(() => localStorage.clear());

describe('creating an account', () => {
  it('sends the name, the e-mail, the password, the language and the consent to the current texts, then holds the session', async () => {
    const { api, meControllerMe, session } = setup();

    const me = await session.signUp(
      'Andrei Marin',
      'andrei@example.ro',
      'o-parola-lunga',
      'en',
    );

    expect(api.authControllerSignUp).toHaveBeenCalledWith({
      body: {
        consent: {
          privacyVersion: PRIVACY_VERSION,
          termsVersion: TERMS_VERSION,
        },
        email: 'andrei@example.ro',
        language: 'en',
        name: 'Andrei Marin',
        password: 'o-parola-lunga',
      },
    });
    expect(session.token()).toBe('signed-up');
    expect(me).toBe(DRIVER);
    expect(session.current()).toBe(DRIVER);
    expect(meControllerMe).toHaveBeenCalledTimes(1);
    expect(api.authControllerRefresh).not.toHaveBeenCalled();
  });

  it('lets a refused sign-up reach the caller, holding no token', async () => {
    const { api, session } = setup();
    api.authControllerSignUp.mockRejectedValueOnce(new Error('409'));

    await expect(
      session.signUp('Andrei', 'andrei@example.ro', 'o-parola-lunga', 'ro'),
    ).rejects.toThrow('409');

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });
});
