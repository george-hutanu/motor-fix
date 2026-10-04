import { TestBed } from '@angular/core/testing';

import { I18n } from './i18n';
import { LanguageChoice, provideRememberedLanguage } from './switch';

function listen() {
  const taps: string[] = [];
  const subscription = TestBed.inject(LanguageChoice).taps.subscribe((l) =>
    taps.push(l),
  );
  return { subscription, taps };
}

beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideRememberedLanguage()] });
});
afterEach(() => jest.restoreAllMocks());

describe('LanguageChoice.pick under hostile input', () => {
  it.each([
    ['uppercase', 'EN'],
    ['padded', ' en'],
    ['trailing newline', 'en\n'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['an object', { toString: () => 'en' }],
    ['an array', ['en']],
    ['a prototype key', '__proto__'],
    ['an inherited method name', 'toString'],
    ['a longer code', 'en-GB'],
  ])('reports no tap and keeps the language for %s', async (_, value) => {
    const { taps } = listen();

    await TestBed.inject(LanguageChoice).pick(value as never);

    expect(taps).toEqual([]);
    expect(TestBed.inject(I18n).language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).toBeNull();
  });

  it('reports each of many rapid taps in order', async () => {
    const { taps } = listen();
    const choice = TestBed.inject(LanguageChoice);

    for (let i = 0; i < 1000; i++) {
      await choice.pick(i % 2 ? 'ro' : 'en');
    }

    expect(taps).toHaveLength(1000);
    expect(taps.slice(0, 4)).toEqual(['en', 'ro', 'en', 'ro']);
    expect(TestBed.inject(I18n).language()).toBe('ro');
  });

  it('reaches every subscriber', async () => {
    const first = listen();
    const second = listen();

    await TestBed.inject(LanguageChoice).pick('en');

    expect(first.taps).toEqual(['en']);
    expect(second.taps).toEqual(['en']);
  });

  it('stops reporting to a subscriber that unsubscribed', async () => {
    const gone = listen();
    const kept = listen();
    gone.subscription.unsubscribe();

    await TestBed.inject(LanguageChoice).pick('en');

    expect(gone.taps).toEqual([]);
    expect(kept.taps).toEqual(['en']);
  });

  it('does not replay earlier taps to a late subscriber', async () => {
    await TestBed.inject(LanguageChoice).pick('en');

    const { taps } = listen();

    expect(taps).toEqual([]);
  });

  it('reports the tap and switches for the visit when storage cannot be written', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { taps } = listen();

    await TestBed.inject(LanguageChoice).pick('en');

    expect(taps).toEqual(['en']);
    expect(TestBed.inject(I18n).language()).toBe('en');
  });
});
