import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK } from '@motor-fix/overlays';

import { FiltersPanel } from './filters-panel';
import { type Filters } from '../filters';

// Every filter off, as an empty address bar reads.
const OFF: Filters = { card: false, open_now: false, open_saturday: false };

const filters = signal<Filters>(OFF);
const change = jest.fn<void, [Partial<Filters>]>();

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: { change, filters },
          focusStart: jest.fn(),
          markUnchanged: jest.fn(),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(FiltersPanel);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const switchOf = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`#mf-filter-${key}`);
const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const groups = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLFieldSetElement>('fieldset.choices'),
];
const choices = (group: HTMLElement | undefined) => [
  ...(group?.querySelectorAll<HTMLButtonElement>('button') ?? []),
];
const pressed = (group: HTMLElement | undefined) =>
  choices(group)
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map(text);

beforeEach(() => {
  filters.set(OFF);
  change.mockReset();
});

// @traces 1398-FR-002
// @traces 1399-FR-001
describe('the filters panel', () => {
  it('holds the two switches, the price and rating groups, then card payment, each named', async () => {
    const host: HTMLElement = (await render()).nativeElement;
    const labels = Array.from(host.querySelectorAll('label'));

    expect(host.querySelectorAll('hlm-switch')).toHaveLength(3);
    expect(labels.map(text)).toEqual([
      'Deschis acum',
      'Deschis sâmbăta',
      'Plată cu cardul',
    ]);
    expect(labels.map((label) => label.getAttribute('for'))).toEqual([
      'mf-filter-open_now',
      'mf-filter-open_saturday',
      'mf-filter-card',
    ]);
    for (const key of ['open_now', 'open_saturday', 'card'])
      expect(switchOf(host, key)?.getAttribute('role')).toBe('switch');
    expect(groups(host).map((g) => text(g.querySelector('legend')))).toEqual([
      'Manoperă până la … lei/oră',
      'Notă minimă',
    ]);
    expect(choices(groups(host)[0]).map(text)).toEqual([
      '150',
      '200',
      '250',
      '300',
    ]);
    expect(choices(groups(host)[1]).map(text)).toEqual([
      '3,5+',
      '4,0+',
      '4,5+',
    ]);
    // The groups sit between the two switches and card payment.
    const order = [...host.querySelectorAll('ul, fieldset')].map(
      (el) => el.tagName,
    );
    expect(order).toEqual(['UL', 'FIELDSET', 'FIELDSET', 'UL']);
  });

  it('names everything in English, the rating with a decimal point', async () => {
    const host: HTMLElement = (await render('en')).nativeElement;

    expect(Array.from(host.querySelectorAll('label')).map(text)).toEqual([
      'Open now',
      'Open on Saturday',
      'Card payment',
    ]);
    expect(groups(host).map((g) => text(g.querySelector('legend')))).toEqual([
      'Labour rate up to … lei/h',
      'Minimum rating',
    ]);
    expect(choices(groups(host)[1]).map(text)).toEqual([
      '3.5+',
      '4.0+',
      '4.5+',
    ]);
  });

  it('shows each control as the bar has it, and follows the bar', async () => {
    filters.set({ ...OFF, open_now: true });
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    expect(switchOf(host, 'open_now')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(switchOf(host, 'card')?.getAttribute('aria-checked')).toBe('false');
    expect(pressed(groups(host)[0])).toEqual([]);
    expect(
      choices(groups(host)[0]).map((b) => b.getAttribute('aria-pressed')),
    ).toEqual(['false', 'false', 'false', 'false']);

    filters.set({ ...OFF, card: true, max_price: 250, min_rating: '4.0' });
    fixture.detectChanges();

    expect(switchOf(host, 'card')?.getAttribute('aria-checked')).toBe('true');
    expect(pressed(groups(host)[0])).toEqual(['250']);
    expect(pressed(groups(host)[1])).toEqual(['4,0+']);
  });

  it('flips a switch at once, with no apply button', async () => {
    filters.set({ ...OFF, open_saturday: true });
    const host: HTMLElement = (await render()).nativeElement;

    switchOf(host, 'open_saturday')?.click();
    switchOf(host, 'card')?.click();

    expect(change.mock.calls).toEqual([
      [{ open_saturday: false }],
      [{ card: true }],
    ]);
    expect(
      [...host.querySelectorAll('button:not([role="switch"])')].filter(
        (b) => !b.closest('fieldset'),
      ),
    ).toHaveLength(0);
  });

  it('chooses a ceiling, replaces it with another, and clears it chosen again', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;
    const [price] = groups(host);

    choices(price)[1]?.click();
    expect(change).toHaveBeenLastCalledWith({ max_price: 200 });

    filters.set({ ...OFF, max_price: 200 });
    fixture.detectChanges();
    choices(price)[3]?.click();
    expect(change).toHaveBeenLastCalledWith({ max_price: 300 });

    choices(price)[1]?.click();
    expect(change).toHaveBeenLastCalledWith({ max_price: undefined });
    expect(change).toHaveBeenCalledTimes(3);
  });

  it('chooses a rating and clears it chosen again', async () => {
    filters.set({ ...OFF, min_rating: '4.5' });
    const host: HTMLElement = (await render()).nativeElement;
    const rating = groups(host)[1];

    choices(rating)[0]?.click();
    expect(change).toHaveBeenLastCalledWith({ min_rating: '3.5' });

    choices(rating)[2]?.click();
    expect(change).toHaveBeenLastCalledWith({ min_rating: undefined });
  });

  it('makes every choice a plain button inside a group named by its title', async () => {
    const host: HTMLElement = (await render()).nativeElement;

    for (const group of groups(host)) {
      expect(group.querySelector('legend')).not.toBeNull();
      for (const button of choices(group)) expect(button.type).toBe('button');
    }
  });
});
