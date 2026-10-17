import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

function account(language: 'ro' | 'en'): MeDto {
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
    language,
    name: 'Andrei',
    pendingEmail: null,
    phone: null,
    phoneConfirmed: false,
    role: 'driver',
    roles: ['driver'],
  } as MeDto;
}

function setup(me: MeDto | null, gate?: Promise<void>) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MeService,
        useValue: {
          meControllerMe: jest.fn(async () => {
            await gate;
            if (!me) throw new Error('401');
            return me;
          }),
          meControllerUpdate: jest.fn(),
        },
      },
      {
        provide: AuthService,
        useValue: {
          authControllerRefresh: () =>
            me
              ? Promise.resolve({ accessToken: 'renewed' })
              : Promise.reject(new Error('401')),
          authControllerSignOut: () => Promise.resolve(),
        },
      },
    ],
  });
  return {
    choice: TestBed.inject(LanguageChoice),
    i18n: TestBed.inject(I18n),
    session: TestBed.inject(Session),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => localStorage.clear());

describe('reading the session while keeping the page language', () => {
  // @traces 1346-FR-005
  it('keeps the address language on a later plain load in the same tab', async () => {
    const { i18n, session } = setup(account('en'));
    await i18n.use('ro');

    await session.load({ keepLanguage: true });
    await session.load();
    await settle();

    expect(i18n.language()).toBe('ro');
  });

  // @traces 1346-FR-005
  it('keeps the page language and the remembered one when the account speaks another', async () => {
    const { i18n, session } = setup(account('en'));
    await i18n.use('ro');
    localStorage.setItem('mf.lang', 'ro');

    const me = await session.load({ keepLanguage: true });
    await settle();

    expect(me?.language).toBe('en');
    expect(session.current()?.role).toBe('driver');
    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBe('ro');
  });

  // @traces 1346-FR-005
  it('still brings the account language on a plain load', async () => {
    const { i18n, session } = setup(account('en'));
    await i18n.use('ro');

    await session.load();
    await settle();

    expect(i18n.language()).toBe('en');
  });

  // @traces 1346-FR-005
  it('brings the account language on a sign-in load that overlaps a kept-language read', async () => {
    let open!: () => void;
    const { i18n, session } = setup(
      account('en'),
      new Promise<void>((resolve) => {
        open = resolve;
      }),
    );
    await i18n.use('ro');

    const kept = session.load({ keepLanguage: true });
    const plain = session.load();
    open();
    await Promise.all([kept, plain]);
    await settle();

    expect(i18n.language()).toBe('en');
  });

  // @traces 1346-FR-005
  it('restores nothing and changes no language when the answer arrives after a sign-out', async () => {
    let open!: () => void;
    const { i18n, session } = setup(
      account('en'),
      new Promise<void>((resolve) => {
        open = resolve;
      }),
    );
    await i18n.use('ro');

    const kept = session.load({ keepLanguage: true });
    await session.signOut();
    open();

    expect(await kept).toBeNull();
    expect(session.current()).toBeNull();
    expect(i18n.language()).toBe('ro');
  });

  // @traces 1346-FR-005
  it('does not switch the language for a visitor with no session', async () => {
    const { i18n, session } = setup(null);
    await i18n.use('en');

    expect(await session.load({ keepLanguage: true })).toBeNull();
    expect(i18n.language()).toBe('en');
  });
});
