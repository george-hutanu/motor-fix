import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

// The session specs' shared harness: one driver account, the Session with
// its services stubbed, and the account loaded.

export function account(overrides: Partial<MeDto> = {}): MeDto {
  return {
    capabilities: [],
    city: null,
    email: 'andrei@example.ro',
    emailConfirmed: true,
    garageAccess: [],
    garageId: null,
    hasPassword: true,
    id: 'account-1',
    landing: '/app/driver',
    language: 'ro',
    name: 'Andrei',
    pendingEmail: null,
    phone: null,
    phoneConfirmed: false,
    role: 'driver',
    roles: ['driver'],
    ...overrides,
  };
}

export const settle = () => new Promise((resolve) => setTimeout(resolve));

const meStubs = () => ({
  meControllerMe: jest.fn(() => Promise.resolve(account())),
});

const authStubs = () => ({
  authControllerRefresh: jest.fn(() =>
    Promise.resolve({ accessToken: 'renewed' }),
  ),
  authControllerSignOut: jest.fn(() => Promise.resolve()),
});

type Merged<D, O> = Omit<D, keyof O> & O;

// biome-ignore lint/complexity/noBannedTypes: no overrides by default
export function setup<M extends object = {}, A extends object = {}>({
  auth: authOverrides = {} as A,
  me: meOverrides = {} as M,
  providers = [],
}: {
  auth?: A;
  me?: M;
  providers?: Provider[];
} = {}) {
  const me = { ...meStubs(), ...meOverrides } as Merged<
    ReturnType<typeof meStubs>,
    M
  >;
  const auth = { ...authStubs(), ...authOverrides } as Merged<
    ReturnType<typeof authStubs>,
    A
  >;
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: me },
      { provide: AuthService, useValue: auth },
      ...providers,
    ],
  });
  return {
    auth,
    choice: TestBed.inject(LanguageChoice),
    i18n: TestBed.inject(I18n),
    me,
    session: TestBed.inject(Session),
  };
}

// biome-ignore lint/complexity/noBannedTypes: no overrides by default
export async function signedIn<M extends object = {}, A extends object = {}>(
  options: { auth?: A; me?: M } = {},
) {
  const parts = setup(options);
  await parts.session.load();
  await settle();
  return parts;
}
