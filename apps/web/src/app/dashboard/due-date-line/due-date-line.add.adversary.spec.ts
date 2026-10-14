import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { DueDateLine } from './due-date-line';

@Component({
  imports: [DueDateLine],
  template: `<mf-due-date-line
    [expiry]="expiry()"
    [keyPrefix]="prefix()"
    [addable]="addable()"
    (add)="added = added + 1"
  />`,
})
class Host {
  readonly expiry = signal<string | null>(null);
  readonly prefix = signal('driver.cars.rca');
  readonly addable = signal(true);
  added = 0;
}

function clockAt(at: string) {
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: new Date(at),
  });
}

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const sentence = () =>
    (element.querySelector('mf-lamp')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  return { element, fixture, i18n, sentence, settle };
}

beforeEach(() => clockAt('2026-10-08T09:00:00Z'));
afterEach(() => jest.useRealTimers());

// @traces 092-FR-009
describe('the grey line that adds a date, under change', () => {
  it('turns into plain text when a date is set, and back into a button when it is cleared', async () => {
    const { element, fixture, settle } = await render();
    expect(element.querySelectorAll('button')).toHaveLength(1);

    fixture.componentInstance.expiry.set('2026-10-20');
    await settle();
    expect(element.querySelectorAll('button')).toHaveLength(0);

    fixture.componentInstance.expiry.set(null);
    await settle();
    expect(element.querySelectorAll('button')).toHaveLength(1);
  });

  it('emits once for each press and none for the press of a line that has a date', async () => {
    const { element, fixture, settle } = await render();
    const button = element.querySelector('button');

    button?.click();
    button?.click();
    expect(fixture.componentInstance.added).toBe(2);

    fixture.componentInstance.expiry.set('2026-10-20');
    await settle();
    expect(element.querySelector('button')).toBeNull();
    expect(fixture.componentInstance.added).toBe(2);
  });

  it('rewrites the grey sentence when the language changes', async () => {
    const { i18n, sentence, settle } = await render();
    expect(sentence()).toBe('RCA: adaugă data');

    await i18n.use('en');
    await settle();

    expect(sentence()).toBe('RCA: add the date');
  });

  it('keeps the button a button when the same line is switched to the rovinietă texts', async () => {
    const { element, fixture, sentence, settle } = await render();

    fixture.componentInstance.prefix.set('driver.cars.rovinieta');
    await settle();

    expect(sentence()).toBe('Rovinietă: adaugă data');
    expect(element.querySelectorAll('button')).toHaveLength(1);
  });

  it('is not a button when addable is switched off', async () => {
    const { element, fixture, sentence, settle } = await render();

    fixture.componentInstance.addable.set(false);
    await settle();

    expect(element.querySelector('button')).toBeNull();
    expect(sentence()).toBe('RCA: adaugă data');
  });
});

// @traces 092-FR-009
describe('the RCA and rovinietă lines at the edges of the clock', () => {
  it.each([
    ['2026-10-15', 'red', 'RCA‑ul expiră în 7 zile'],
    ['2026-10-16', 'amber', 'RCA‑ul expiră în 8 zile'],
    ['2026-12-07', 'amber', 'RCA‑ul expiră în 60 de zile'],
    ['2026-12-08', 'green', 'RCA valabilă până în decembrie 2026'],
  ])('shows %s as %s: %s', async (day, state, words) => {
    const { element, fixture, sentence, settle } = await render();

    fixture.componentInstance.expiry.set(day);
    await settle();

    expect(element.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      state,
    );
    expect(sentence()).toBe(words);
  });

  it('shows a date five years ahead as valid with the month and year', async () => {
    const { fixture, sentence, settle } = await render();

    fixture.componentInstance.expiry.set('2031-10-08');
    await settle();

    expect(sentence()).toBe('RCA valabilă până în octombrie 2031');
  });

  it.each([['2026-02-30'], ['not a date'], [''], ['2026-13-01']])(
    'writes no NaN and no undefined for the date %j',
    async (bad) => {
      const { element, fixture, settle } = await render();

      fixture.componentInstance.expiry.set(bad);
      await settle();

      expect(element.textContent).not.toMatch(/NaN|undefined|Invalid/);
    },
  );
});
