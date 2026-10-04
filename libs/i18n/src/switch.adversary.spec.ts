import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { I18n } from './i18n';
import {
  LanguageChoice,
  LanguageSwitch,
  provideRememberedLanguage,
} from './switch';

@Component({ imports: [LanguageSwitch], template: '<mf-language-switch />' })
class Host {}

const settle = () => new Promise((resolve) => setTimeout(resolve));

async function start() {
  TestBed.configureTestingModule({ providers: [provideRememberedLanguage()] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  await settle();
  await fixture.whenStable();
  return { fixture, i18n: TestBed.inject(I18n) };
}

function buttons(fixture: { nativeElement: unknown }) {
  const all = [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll('button'),
  ];
  return {
    all,
    en: all.find((b) => b.textContent?.trim() === 'EN') as HTMLButtonElement,
    ro: all.find((b) => b.textContent?.trim() === 'RO') as HTMLButtonElement,
  };
}

function storageEvent(newValue: string | null, key = 'mf.lang') {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

function unreachableStorage() {
  jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('LanguageSwitch under hostile conditions', () => {
  it('renders exactly two buttons, RO then EN', async () => {
    const { fixture } = await start();

    expect(buttons(fixture).all.map((b) => b.textContent?.trim())).toEqual([
      'RO',
      'EN',
    ]);
  });

  it('switches for the visit when storage reads fine but writes throw', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { fixture, i18n } = await start();

    buttons(fixture).en.click();
    await settle();
    await fixture.whenStable();

    expect(i18n.language()).toBe('en');
    expect(buttons(fixture).en.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens in Romanian when reading the storage object itself throws', async () => {
    unreachableStorage();

    const { i18n } = await start();

    expect(i18n.language()).toBe('ro');
  });

  it('chooses without an error when the storage object itself is unreachable', async () => {
    const { i18n } = await start();
    unreachableStorage();

    await TestBed.inject(LanguageChoice).choose('en');

    expect(i18n.language()).toBe('en');
  });

  it.each([
    'EN',
    ' en',
    'en ',
    '',
    'en\u0000',
    'ｅｎ',
    '__proto__',
    'constructor',
    'toString',
  ])('ignores the remembered value %j', async (value) => {
    localStorage.setItem('mf.lang', value);

    const { i18n } = await start();

    expect(i18n.language()).toBe('ro');
  });

  it.each([
    'xx',
    'EN',
    '',
    '__proto__',
    'constructor',
    '[object Object]',
  ])('ignores a value from another tab that is %j', async (value) => {
    const { i18n } = await start();

    storageEvent(value);
    await settle();

    expect(i18n.language()).toBe('ro');
  });

  it('does not write back a value received from another tab', async () => {
    const { i18n } = await start();
    const write = jest.spyOn(Storage.prototype, 'setItem');

    storageEvent('en');
    await settle();

    expect(i18n.language()).toBe('en');
    expect(write).not.toHaveBeenCalled();
  });

  it('stays in English when another tab clears the value', async () => {
    const { i18n } = await start();
    storageEvent('en');
    await settle();

    storageEvent(null);
    await settle();

    expect(i18n.language()).toBe('en');
  });

  it('follows the other tab back and forth, last event wins', async () => {
    const { i18n } = await start();

    storageEvent('en');
    storageEvent('ro');
    storageEvent('en');
    await settle();

    expect(i18n.language()).toBe('en');
  });

  it('refuses an unsupported language passed to the service', async () => {
    const { i18n } = await start();

    await TestBed.inject(LanguageChoice).choose('fr' as never);

    expect(i18n.language()).toBe('ro');
    expect(localStorage.getItem('mf.lang')).not.toBe('fr');
  });

  it('ends on the last language after rapid taps and stores it', async () => {
    const { fixture, i18n } = await start();
    const { en, ro } = buttons(fixture);

    en.click();
    ro.click();
    en.click();
    await settle();
    await fixture.whenStable();

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('is idempotent when the same language is chosen twice', async () => {
    const { i18n } = await start();
    const choice = TestBed.inject(LanguageChoice);

    await choice.choose('en');
    await choice.choose('en');

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('keeps a first visit Romanian whatever the browser language', async () => {
    jest.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    jest.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'en']);

    const { i18n } = await start();

    expect(i18n.language()).toBe('ro');
  });

  it('marks exactly one button pressed after a switch from another tab', async () => {
    const { fixture } = await start();
    storageEvent('en');
    await settle();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      buttons(fixture).all.map((b) => b.getAttribute('aria-pressed')),
    ).toEqual(['false', 'true']);
  });
});
