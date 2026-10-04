import { TestBed } from '@angular/core/testing';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

function account(language: 'ro' | 'en') {
  return {
    capabilities: [],
    email: 'andrei@example.ro',
    garageId: null,
    id: 'account-1',
    landing: '/app/driver',
    language,
    name: 'Andrei',
    role: 'driver',
    roles: ['driver'],
  } as unknown as MeDto;
}

function setup(me: MeDto | null) {
  const meControllerMe = jest.fn(() =>
    me ? Promise.resolve(me) : Promise.reject(new Error('401')),
  );
  TestBed.configureTestingModule({
    providers: [{ provide: MeService, useValue: { meControllerMe } }],
  });
  return { i18n: TestBed.inject(I18n), session: TestBed.inject(Session) };
}

beforeEach(() => localStorage.clear());

describe('Session', () => {
  it("switches to the account's language when the session loads, and remembers it", async () => {
    localStorage.setItem('mf.lang', 'ro');
    const { i18n, session } = setup(account('en'));

    await session.load();
    await new Promise((resolve) => setTimeout(resolve));

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('lets a tap made while signed in stand on the next load', async () => {
    const { i18n, session } = setup(account('en'));
    await session.load();
    await new Promise((resolve) => setTimeout(resolve));

    await TestBed.inject(LanguageChoice).choose('ro');
    await session.load();
    await new Promise((resolve) => setTimeout(resolve));

    expect(i18n.language()).toBe('ro');
  });

  it('changes nothing when nobody is signed in', async () => {
    const { i18n, session } = setup(null);

    expect(await session.load()).toBeNull();

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBeNull();
  });
});
