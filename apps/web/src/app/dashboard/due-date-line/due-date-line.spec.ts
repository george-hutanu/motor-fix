import { ChangeDetectorRef, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { DueDateLine, dueDateStatus } from './due-date-line';

type Link = {
  label: string;
  path: unknown[];
  query: Record<string, string>;
} | null;

@Component({
  imports: [DueDateLine],
  template: `<mf-due-date-line
    [expiry]="expiry()"
    keyPrefix="driver.cars.itp"
    [link]="link()"
  />`,
})
class Host {
  readonly expiry = signal<string | null>(null);
  readonly link = signal<Link>(null);
}

const GARAGES: Link = {
  label: 'driver.cars.findGarage',
  path: ['/', 'ro', 'garages'],
  query: { brand: 'bmw' },
};

// Only Date is faked: Angular's stability checks still need real timers.
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

afterEach(() => jest.useRealTimers());

// What a parent does when anything on the card changes: the line is checked
// again with the same inputs.
function redraw(fixture: ComponentFixture<unknown>) {
  fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
  fixture.detectChanges();
}

async function render(
  expiry: string | null,
  language: 'ro' | 'en' = 'ro',
  link: Link = null,
) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.expiry.set(expiry);
  fixture.componentInstance.link.set(link);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const lamp = () => element.querySelector('mf-lamp') as HTMLElement;
  return {
    anchor: () => element.querySelector('a'),
    element,
    fixture,
    sentence: () => (lamp().textContent ?? '').replace(/\s+/g, ' ').trim(),
    state: () => lamp().getAttribute('data-state'),
  };
}

describe('dueDateStatus', () => {
  const now = new Date('2026-10-08T09:00:00Z');

  it.each([
    [null, 'grey', null, false],
    ['not a date', 'grey', null, false],
    ['2026-10-07', 'red', -1, true],
    ['2025-10-08', 'red', -365, true],
    ['2026-10-08', 'red', 0, false],
    ['2026-10-15', 'red', 7, false],
    ['2026-10-16', 'amber', 8, false],
    ['2026-12-07', 'amber', 60, false],
    ['2026-12-08', 'green', 61, false],
  ])('reads %p as %s', (expiry, state, days, passed) => {
    expect(dueDateStatus(expiry, now)).toEqual({ days, passed, state });
  });
});

describe('the due-date line', () => {
  beforeEach(() => clockAt('2026-10-08T09:00:00Z'));

  it.each([
    ['2026-12-08', 'green', 'ITP valabil până în decembrie 2026'],
    ['2026-12-07', 'amber', 'ITP‑ul expiră în 60 de zile'],
    ['2026-10-16', 'amber', 'ITP‑ul expiră în 8 zile'],
    ['2026-10-15', 'red', 'ITP‑ul expiră în 7 zile'],
    ['2026-10-09', 'red', 'ITP‑ul expiră mâine'],
    ['2026-10-08', 'red', 'ITP‑ul expiră azi'],
    ['2026-10-07', 'red', 'ITP‑ul a expirat pe 7 oct. 2026'],
    [null, 'grey', 'ITP: adaugă data din talon'],
  ])('shows %p as a %s lamp reading "%s"', async (expiry, state, text) => {
    const line = await render(expiry);

    expect(line.state()).toBe(state);
    expect(line.sentence()).toBe(text);
  });

  it.each([
    ['2026-12-08', 'green', 'ITP valid until December 2026'],
    ['2026-12-07', 'amber', 'ITP expires in 60 days'],
    ['2026-10-16', 'amber', 'ITP expires in 8 days'],
    ['2026-10-15', 'red', 'ITP expires in 7 days'],
    ['2026-10-09', 'red', 'ITP expires tomorrow'],
    ['2026-10-08', 'red', 'ITP expires today'],
    ['2026-10-07', 'red', 'ITP expired on 7 Oct 2026'],
    [null, 'grey', 'ITP: add the date from the registration'],
  ])(
    'shows %p in English as a %s lamp reading "%s"',
    async (expiry, state, text) => {
      const line = await render(expiry, 'en');

      expect(line.state()).toBe(state);
      expect(line.sentence()).toBe(text);
    },
  );

  it.each([
    ['2026-10-10', 'ITP‑ul expiră în 2 zile'],
    ['2026-10-27', 'ITP‑ul expiră în 19 zile'],
    ['2026-10-28', 'ITP‑ul expiră în 20 de zile'],
    ['2026-11-13', 'ITP‑ul expiră în 36 de zile'],
  ])('writes the Romanian plural for %p', async (expiry, text) => {
    expect((await render(expiry)).sentence()).toBe(text);
  });

  it('keeps the ITP valid through its last day, until Bucharest midnight', async () => {
    clockAt('2026-10-08T20:59:00Z');
    const line = await render('2026-10-08');
    expect(line.sentence()).toBe('ITP‑ul expiră azi');

    jest.setSystemTime(new Date('2026-10-08T21:00:00Z'));
    redraw(line.fixture);
    expect(line.sentence()).toBe('ITP‑ul a expirat pe 8 oct. 2026');
    expect(line.state()).toBe('red');
  });

  it('gives the lamp the sentence as its label and hides the dot', async () => {
    const line = await render('2026-10-16');
    const dot = line.element.querySelector('.mf-lamp-dot');

    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(line.sentence()).toBe('ITP‑ul expiră în 8 zile');
  });

  it('reads the clock again on the next check, with no new input', async () => {
    const line = await render('2026-10-16');
    expect(line.state()).toBe('amber');

    jest.setSystemTime(new Date('2026-10-09T09:00:00Z'));
    redraw(line.fixture);

    expect(line.state()).toBe('red');
    expect(line.sentence()).toBe('ITP‑ul expiră în 7 zile');
  });
});

describe('the garage link on a passed date', () => {
  beforeEach(() => clockAt('2026-10-08T09:00:00Z'));

  it('sends a passed date to the garages for the brand', async () => {
    const line = await render('2026-10-07', 'ro', GARAGES);
    const anchor = line.anchor();

    expect(anchor?.textContent?.trim()).toBe('Caută un service');
    expect(anchor?.getAttribute('href')).toBe('/ro/garages?brand=bmw');
  });

  it('names the link in English', async () => {
    const line = await render('2026-10-07', 'en', {
      ...GARAGES!,
      path: ['/', 'en', 'garages'],
    });

    expect(line.anchor()?.textContent?.trim()).toBe('Find a garage');
    expect(line.anchor()?.getAttribute('href')).toBe('/en/garages?brand=bmw');
  });

  it.each([
    '2026-10-08',
    '2026-10-15',
    '2026-10-16',
    '2026-12-07',
    '2026-12-08',
    null,
  ])('has no link for %p', async (expiry) => {
    expect((await render(expiry, 'ro', GARAGES)).anchor()).toBeNull();
  });

  it('has no link on a passed date when none is given', async () => {
    expect((await render('2026-10-07')).anchor()).toBeNull();
  });
});

describe('the line across midnight and summer time', () => {
  it.each([
    ['2026-03-28T21:59:00Z', '2026-03-28T22:00:00Z', '2026-03-29'],
    ['2026-10-24T20:59:00Z', '2026-10-24T21:00:00Z', '2026-10-25'],
    ['2026-10-25T21:59:00Z', '2026-10-25T22:00:00Z', '2026-10-26'],
  ])(
    'moves from tomorrow to today at Bucharest midnight (%s)',
    async (before, after, expiry) => {
      clockAt(before);
      const line = await render(expiry);
      expect(line.sentence()).toBe('ITP‑ul expiră mâine');

      jest.setSystemTime(new Date(after));
      redraw(line.fixture);

      expect(line.sentence()).toBe('ITP‑ul expiră azi');
    },
  );
});
