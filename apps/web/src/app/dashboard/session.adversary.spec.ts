import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';
import { LanguageChoice } from '@motor-fix/i18n';

import { account, settle, setup } from './signed-in.testing';

// Each load asks the server through the given answer.
function answering(answer: () => Promise<MeDto>) {
  const parts = setup({ me: { meControllerMe: jest.fn(answer) } });
  return { ...parts, meControllerMe: parts.me.meControllerMe };
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('Session language at sign-in', () => {
  it('asks the server once for two loads in flight and applies English', async () => {
    const { i18n, meControllerMe, session } = answering(() =>
      Promise.resolve(account({ language: 'en' })),
    );

    const [a, b] = await Promise.all([session.load(), session.load()]);
    await settle();

    expect(a).toBe(b);
    expect(meControllerMe).toHaveBeenCalledTimes(1);
    expect(i18n.language()).toBe('en');
  });

  it('applies the account language again after signing out and back in', async () => {
    const { i18n, session } = answering(() =>
      Promise.resolve(account({ language: 'en' })),
    );
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
    const { i18n, session } = answering(() =>
      Promise.resolve(account({ language: 'en' })),
    );
    await session.load();
    await settle();

    session.current.set(null);
    await settle();

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('keeps the device language when the account language is not supported', async () => {
    localStorage.setItem('mf.lang', 'en');
    const { i18n, session } = answering(() =>
      Promise.resolve(account({ language: 'fr' as MeDto['language'] })),
    );

    await session.load();
    await settle();

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).not.toBe('fr');
  });

  it('keeps the language and the memory when the session request fails', async () => {
    localStorage.setItem('mf.lang', 'ro');
    const { i18n, session } = answering(() => Promise.reject(new Error('500')));

    expect(await session.load()).toBeNull();
    await settle();

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBe('ro');
  });

  it('retries the request after a failed load', async () => {
    let calls = 0;
    const { i18n, session } = answering(() =>
      ++calls === 1
        ? Promise.reject(new Error('503'))
        : Promise.resolve(account({ language: 'en' })),
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
    const { i18n, session } = answering(() =>
      Promise.resolve(account({ language: 'en' })),
    );

    const me = await session.load();
    await settle();

    expect(me?.language).toBe('en');
    expect(i18n.language()).toBe('en');
  });

  it('does not override a tap made while signed in when the known session is loaded again', async () => {
    const { i18n, meControllerMe, session } = answering(() =>
      Promise.resolve(account({ language: 'en' })),
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
