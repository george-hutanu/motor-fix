import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

function account(language: string) {
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

const settle = () => new Promise((resolve) => setTimeout(resolve));

function setup(answer: () => Promise<MeDto>) {
  const meControllerMe = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      {
        provide: AuthService,
        useValue: {
          authControllerRefresh: async () => ({ accessToken: 'renewed' }),
          authControllerSignOut: async () => undefined,
        },
      },
    ],
  });
  return {
    i18n: TestBed.inject(I18n),
    meControllerMe,
    session: TestBed.inject(Session),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('Session language at sign-in', () => {
  it('asks the server once for two loads in flight and applies English', async () => {
    const { i18n, meControllerMe, session } = setup(() =>
      Promise.resolve(account('en')),
    );

    const [a, b] = await Promise.all([session.load(), session.load()]);
    await settle();

    expect(a).toBe(b);
    expect(meControllerMe).toHaveBeenCalledTimes(1);
    expect(i18n.language()).toBe('en');
  });

  it('applies the account language again after signing out and back in', async () => {
    const { i18n, session } = setup(() => Promise.resolve(account('en')));
    await session.load();
    await settle();
    await TestBed.inject(LanguageChoice).choose('ro');

    session.current.set(null);
    await session.load();
    await settle();

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('leaves the remembered language alone when signing out', async () => {
    const { i18n, session } = setup(() => Promise.resolve(account('en')));
    await session.load();
    await settle();

    session.current.set(null);
    await settle();

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('keeps the device language when the account language is not supported', async () => {
    localStorage.setItem('mf.lang', 'en');
    const { i18n, session } = setup(() => Promise.resolve(account('fr')));

    await session.load();
    await settle();

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).not.toBe('fr');
  });

  it('keeps the language and the memory when the session request fails', async () => {
    localStorage.setItem('mf.lang', 'ro');
    const { i18n, session } = setup(() => Promise.reject(new Error('500')));

    expect(await session.load()).toBeNull();
    await settle();

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBe('ro');
  });

  it('retries the request after a failed load', async () => {
    let calls = 0;
    const { i18n, session } = setup(() =>
      ++calls === 1
        ? Promise.reject(new Error('503'))
        : Promise.resolve(account('en')),
    );

    expect(await session.load()).toBeNull();
    await session.load();
    await settle();

    expect(calls).toBe(2);
    expect(i18n.language()).toBe('en');
  });

  it('still switches to the account language when storage is blocked', async () => {
    const blocked = () => {
      throw new DOMException('insecure', 'SecurityError');
    };
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const { i18n, session } = setup(() => Promise.resolve(account('en')));

    const me = await session.load();
    await settle();

    expect(me?.language).toBe('en');
    expect(i18n.language()).toBe('en');
  });

  it('does not override a tap made while signed in when the known session is loaded again', async () => {
    const { i18n, meControllerMe, session } = setup(() =>
      Promise.resolve(account('en')),
    );
    await session.load();
    await settle();
    await TestBed.inject(LanguageChoice).choose('ro');

    await session.load();
    await settle();

    expect(meControllerMe).toHaveBeenCalledTimes(1);
    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBe('ro');
  });
});
