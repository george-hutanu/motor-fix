import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { AdminLogFiltersSheet } from './admin-log-filters-sheet';
import type { LogChoice } from '../admin-log-view/narrowing';

@Component({
  template:
    '<button type="button" class="opener" (click)="open()">Filtre</button>',
})
class Host {
  readonly overlays = inject(Overlays);
  result: Promise<OverlayResult<LogChoice>> | undefined;
  data: LogChoice = {
    from: '2026-10-11',
    severity: 'error',
    source: null,
    to: '2026-10-17',
    type: 'backup',
  };

  open() {
    this.result = this.overlays.open<LogChoice, LogChoice>(
      AdminLogFiltersSheet,
      {
        confirmDiscard: false,
        data: this.data,
        shape: 'dialog',
        title: 'admin.log.view.filters.title',
      },
    );
  }
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'queueMicrotask',
      'nextTick',
      'setImmediate',
      'setTimeout',
      'requestAnimationFrame',
    ],
    now: new Date('2026-10-17T12:00:00.000Z'),
  });
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: false,
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function open(language: 'ro' | 'en' = 'ro') {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  await settle();
  const opener = fixture.nativeElement.querySelector(
    '.opener',
  ) as HTMLButtonElement;
  opener.focus();
  opener.click();
  await settle();
  return { host: fixture.componentInstance, opener };
}

const sheet = () =>
  document.querySelector<HTMLElement>(
    'mf-admin-log-filters-sheet',
  ) as HTMLElement;
const control = <T extends HTMLElement>(selector: string) =>
  sheet().querySelector(selector) as T;
const choose = (
  target: HTMLSelectElement | HTMLInputElement,
  value: string,
) => {
  target.value = value;
  target.dispatchEvent(new Event('change'));
};
const button = (label: string) =>
  [...sheet().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement;

// @traces 299-FR-008 299-FR-015
describe("the log's filters sheet", () => {
  it('holds the three pickers and the two dates, showing the current choice', async () => {
    await open();

    expect(control<HTMLSelectElement>('select.type').value).toBe('backup');
    expect(control<HTMLSelectElement>('select.severity').value).toBe('error');
    expect(control<HTMLSelectElement>('select.source').value).toBe('');
    expect(control<HTMLInputElement>('input.from').value).toBe('2026-10-11');
    expect(control<HTMLInputElement>('input.to').value).toBe('2026-10-17');
  });

  it('applies the choice made in it', async () => {
    const { host } = await open();

    choose(control('select.source'), 'backup');
    choose(control('input.from'), '2026-10-01');
    await settle();
    button('Aplică').click();
    await settle();

    await expect(host.result).resolves.toEqual({
      from: '2026-10-01',
      severity: 'error',
      source: 'backup',
      to: '2026-10-17',
      type: 'backup',
    });
  });

  it('does not apply an end before the start, and says so on the end', async () => {
    await open();

    choose(control('input.to'), '2026-10-05');
    await settle();
    button('Aplică').click();
    await settle();

    expect(sheet()).not.toBeNull();
    const to = control<HTMLInputElement>('input.to');
    expect(to.getAttribute('aria-invalid')).toBe('true');
    const id = to.getAttribute('aria-describedby') as string;
    expect(document.getElementById(id)?.textContent?.trim()).toBe(
      '„Până la” nu poate fi înainte de „De la”.',
    );
  });

  it('moves focus into itself when it opens', async () => {
    await open();

    expect(
      document.activeElement?.closest('[role="dialog"], dialog'),
    ).not.toBeNull();
  });

  it('closes on Escape with no change and gives focus back to the button that opened it', async () => {
    const { host, opener } = await open();

    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(host.result).resolves.toBe('cancelled');
    expect(document.activeElement).toBe(opener);
  });

  it('reads in English', async () => {
    await open('en');

    expect(button('Apply')).toBeDefined();
    expect(
      sheet()
        .querySelector(`label[for="${control('input.to').id}"]`)
        ?.textContent?.trim(),
    ).toBe('To');
  });
});
