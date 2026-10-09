import { TestBed } from '@angular/core/testing';
import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const OWNER = {
  capabilities: [],
  email: 'mihai@example.ro',
  garageAccess: [],
  garageId: 'garage-1',
  id: 'account-1',
  landing: '/app/garage',
  language: 'ro',
  name: 'Mihai Ionescu',
  role: 'garage',
  roles: ['garage'],
} as unknown as MeDto;

function setup() {
  const api = {
    authControllerRefresh: jest.fn(() => Promise.reject(new Error('401'))),
    phoneSignInControllerPhoneCode: jest.fn(() => Promise.resolve()),
    phoneSignInControllerPhoneSignIn: jest.fn(() =>
      Promise.resolve({ accessToken: 'by-phone' }),
    ),
  };
  const meControllerMe = jest.fn(() => Promise.resolve(OWNER));
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      { provide: AuthService, useValue: api },
    ],
  });
  return { api, session: TestBed.inject(Session) };
}

beforeEach(() => localStorage.clear());

describe('signing in with a phone number', () => {
  it('asks for a code for the number, in the language given', async () => {
    const { api, session } = setup();

    await session.phoneCode('+40722123456', 'en');

    expect(api.phoneSignInControllerPhoneCode).toHaveBeenCalledWith({
      body: { language: 'en', phone: '+40722123456' },
    });
    expect(session.token()).toBeNull();
  });

  it('sends the number, the code and "keep me signed in", then holds the session', async () => {
    const { api, session } = setup();

    const me = await session.signInWithPhone('+40722123456', '012345', false);

    expect(api.phoneSignInControllerPhoneSignIn).toHaveBeenCalledWith({
      body: { code: '012345', phone: '+40722123456', remember: false },
    });
    expect(session.token()).toBe('by-phone');
    expect(me).toBe(OWNER);
  });

  it('answers "profile" for a number no account holds, holding no token', async () => {
    const { api, session } = setup();
    api.phoneSignInControllerPhoneSignIn.mockResolvedValueOnce({
      next: 'profile',
    } as never);

    const answer = await session.signInWithPhone(
      '+40733000000',
      '012345',
      true,
    );

    expect(answer).toBe('profile');
    expect(session.token()).toBeNull();
  });

  it('creates the account with the name, the current consent and the language', async () => {
    const { api, session } = setup();

    const me = await session.signInWithPhone('+40733000000', '012345', true, {
      language: 'en',
      name: 'Ion Popescu',
    });

    expect(api.phoneSignInControllerPhoneSignIn).toHaveBeenCalledWith({
      body: {
        code: '012345',
        consent: CURRENT_CONSENT,
        language: 'en',
        name: 'Ion Popescu',
        phone: '+40733000000',
        remember: true,
      },
    });
    expect(me).toBe(OWNER);
  });

  it('lets a refused code reach the caller, holding no token', async () => {
    const { api, session } = setup();
    api.phoneSignInControllerPhoneSignIn.mockRejectedValueOnce(
      new Error('401'),
    );

    await expect(
      session.signInWithPhone('+40722123456', '999999', true),
    ).rejects.toThrow('401');

    expect(session.token()).toBeNull();
  });
});
