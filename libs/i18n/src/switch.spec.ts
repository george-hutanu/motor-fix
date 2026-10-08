import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === name,
    ) as HTMLButtonElement;
  return { button, element, fixture };
}

async function tap(
  fixture: { whenStable(): Promise<unknown> },
  b: HTMLElement,
) {
  b.click();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}

function blockStorage() {
  const blocked = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('LanguageSwitch', () => {
  it('is a group named "Limba" with RO pressed and EN not pressed', () => {
    const { button, element } = render();

    const group = element.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Limba');
    expect(button('RO').getAttribute('aria-pressed')).toBe('true');
    expect(button('EN').getAttribute('aria-pressed')).toBe('false');
    expect(TestBed.inject(I18n).language()).toBe('ro');
  });

  it('switches to English in place, and back to Romanian', async () => {
    const { button, element, fixture } = render();

    await tap(fixture, button('EN'));

    expect(TestBed.inject(I18n).language()).toBe('en');
    expect(button('EN').getAttribute('aria-pressed')).toBe('true');
    expect(button('RO').getAttribute('aria-pressed')).toBe('false');
    expect(
      element.querySelector('[role="group"]')?.getAttribute('aria-label'),
    ).toBe('Language');

    await tap(fixture, button('RO'));

    expect(TestBed.inject(I18n).language()).toBe('ro');
    expect(button('RO').getAttribute('aria-pressed')).toBe('true');
  });

  it('changes nothing when the current language is tapped', async () => {
    const { button, fixture } = render();

    await tap(fixture, button('RO'));

    expect(TestBed.inject(I18n).language()).toBe('ro');
    expect(button('RO').getAttribute('aria-pressed')).toBe('true');
  });

  it('remembers the choice on the device', async () => {
    const { button, fixture } = render();

    await tap(fixture, button('EN'));

    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('still switches, without an error, when storage is blocked', async () => {
    blockStorage();
    const { button, fixture } = render();

    await tap(fixture, button('EN'));

    expect(TestBed.inject(I18n).language()).toBe('en');
  });
});

describe('provideRememberedLanguage', () => {
  async function start() {
    TestBed.configureTestingModule({
      providers: [provideRememberedLanguage()],
    });
    const { fixture } = render();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return TestBed.inject(I18n);
  }

  it('opens in Romanian when nothing is remembered', async () => {
    expect((await start()).language()).toBe('ro');
  });

  it('opens in the remembered language once the page has rendered', async () => {
    localStorage.setItem('mf.lang', 'en');

    expect((await start()).language()).toBe('en');
  });

  it('ignores a remembered value that is not a language', async () => {
    localStorage.setItem('mf.lang', 'xx');

    expect((await start()).language()).toBe('ro');
  });

  it('opens in Romanian, without an error, when storage is blocked', async () => {
    blockStorage();

    expect((await start()).language()).toBe('ro');
  });

  it('follows a choice made in another tab', async () => {
    const i18n = await start();

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'mf.lang', newValue: 'en' }),
    );
    await new Promise((resolve) => setTimeout(resolve));

    expect(i18n.language()).toBe('en');
  });

  it('ignores storage events for other keys or with no value', async () => {
    const i18n = await start();

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'other', newValue: 'en' }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'mf.lang', newValue: null }),
    );
    await new Promise((resolve) => setTimeout(resolve));

    expect(i18n.language()).toBe('ro');
  });

  it('stores the language chosen through the service', async () => {
    const i18n = await start();

    await TestBed.inject(LanguageChoice).choose('en');

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });
});

describe('LanguageChoice.saved', () => {
  const saved = () => TestBed.inject(LanguageChoice).saved();

  it('returns the remembered language', () => {
    localStorage.setItem('mf.lang', 'en');

    expect(saved()).toBe('en');
  });

  it('returns null when nothing, or no language, is remembered', () => {
    expect(saved()).toBeNull();

    localStorage.setItem('mf.lang', 'xx');

    expect(saved()).toBeNull();
  });

  it('returns null, without an error, when storage is blocked', () => {
    blockStorage();

    expect(saved()).toBeNull();
  });
});

describe('LanguageChoice.taps', () => {
  function listen() {
    const taps: string[] = [];
    TestBed.inject(LanguageChoice).taps.subscribe((l) => taps.push(l));
    return taps;
  }

  it('reports each tap on the switch, the current language included', async () => {
    const { button, fixture } = render();
    const taps = listen();

    await tap(fixture, button('EN'));
    await tap(fixture, button('EN'));
    await tap(fixture, button('RO'));

    expect(taps).toEqual(['en', 'en', 'ro']);
  });

  it('reports nothing for a language chosen without the switch', async () => {
    TestBed.configureTestingModule({
      providers: [provideRememberedLanguage()],
    });
    const { fixture } = render();
    const taps = listen();

    await TestBed.inject(LanguageChoice).choose('en');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'mf.lang', newValue: 'ro' }),
    );
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(taps).toEqual([]);
  });

  it('reports nothing for a value that is not a language', async () => {
    const taps = listen();

    await TestBed.inject(LanguageChoice).pick('fr');

    expect(taps).toEqual([]);
    expect(TestBed.inject(I18n).language()).toBe('ro');
  });

  it('switches and remembers a picked language like a chosen one', async () => {
    await TestBed.inject(LanguageChoice).pick('en');

    expect(TestBed.inject(I18n).language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });
});

describe('the language switch buttons', () => {
  const source = readFileSync(join(__dirname, 'switch.ts'), 'utf8');

  it('read at the page size, not the browser button size, on the 4 px grid', () => {
    expect(source).toMatch(
      /button \{[^}]*font: inherit;[^}]*font-size: var\(--mf-size-body, 16px\);/,
    );
    expect(source).toMatch(/button \{[^}]*padding: 4px 8px;/);
  });
});
