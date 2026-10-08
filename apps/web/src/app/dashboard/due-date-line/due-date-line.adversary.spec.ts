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
    anchors: () => element.querySelectorAll('a'),
    element,
    fixture,
    i18n,
    sentence: () => (lamp().textContent ?? '').replace(/\s+/g, ' ').trim(),
    state: () => lamp().getAttribute('data-state'),
  };
}

describe('dueDateStatus at the edges', () => {
  const now = new Date('2026-10-08T09:00:00Z');

  it.each([
    [undefined, 'grey', null, false],
    ['', 'grey', null, false],
    [' 2026-10-09', 'grey', null, false],
    ['2026-02-30', 'grey', null, false],
    ['2026-10-09T00:00:00Z', 'grey', null, false],
    ['2026-10-09', 'red', 1, false],
    ['1970-01-01', 'red', -20734, true],
    ['9999-12-31', 'green', 2912162, false],
  ])('reads %p as %s', (expiry, state, days, passed) => {
    expect(dueDateStatus(expiry as unknown as string | null, now)).toEqual({
      days,
      passed,
      state,
    });
  });

  it.each([
    ['2026-10-08T20:59:59.999Z', 'red', 7],
    ['2026-10-08T21:00:00.000Z', 'red', 6],
  ])('counts 15 October from %s as %s with %p days', (at, state, days) => {
    expect(dueDateStatus('2026-10-15', new Date(at))).toEqual({
      days,
      passed: false,
      state,
    });
  });

  it.each([
    ['2026-10-08T20:59:59.999Z', 'amber', 8],
    ['2026-10-08T21:00:00.000Z', 'red', 7],
  ])(
    'moves 16 October from amber to red at midnight (%s)',
    (at, state, days) => {
      expect(dueDateStatus('2026-10-16', new Date(at))).toEqual({
        days,
        passed: false,
        state,
      });
    },
  );

  it('moves a green date to amber across the Bucharest midnight', () => {
    expect(
      dueDateStatus('2026-12-08', new Date('2026-10-08T20:59:59.999Z')).state,
    ).toBe('green');
    expect(
      dueDateStatus('2026-12-08', new Date('2026-10-08T21:00:00.000Z')),
    ).toEqual({ days: 60, passed: false, state: 'amber' });
  });

  it('keeps the thresholds across the spring and autumn clock changes', () => {
    expect(
      dueDateStatus('2026-03-30', new Date('2026-03-23T10:00:00Z')),
    ).toEqual({ days: 7, passed: false, state: 'red' });
    expect(
      dueDateStatus('2026-10-26', new Date('2026-10-18T10:00:00Z')),
    ).toEqual({ days: 8, passed: false, state: 'amber' });
  });
});

describe('the due-date line at the edges', () => {
  beforeEach(() => clockAt('2026-10-08T09:00:00Z'));

  it.each([
    ['2026-10-11', 'ITP‑ul expiră în 3 zile'],
    ['2026-10-12', 'ITP‑ul expiră în 4 zile'],
    ['2026-10-13', 'ITP‑ul expiră în 5 zile'],
    ['2026-10-14', 'ITP‑ul expiră în 6 zile'],
    ['2026-10-19', 'ITP‑ul expiră în 11 zile'],
    ['2026-10-20', 'ITP‑ul expiră în 12 zile'],
    ['2026-10-26', 'ITP‑ul expiră în 18 zile'],
    ['2026-10-29', 'ITP‑ul expiră în 21 de zile'],
    ['2026-10-30', 'ITP‑ul expiră în 22 de zile'],
    ['2026-11-07', 'ITP‑ul expiră în 30 de zile'],
    ['2026-12-06', 'ITP‑ul expiră în 59 de zile'],
  ])('writes the Romanian plural for %s', async (expiry, text) => {
    expect((await render(expiry)).sentence()).toBe(text);
  });

  it.each([
    ['2026-10-10', 'ITP expires in 2 days'],
    ['2026-10-28', 'ITP expires in 20 days'],
    ['2026-10-29', 'ITP expires in 21 days'],
    ['2026-11-07', 'ITP expires in 30 days'],
  ])('writes the English plural for %s', async (expiry, text) => {
    expect((await render(expiry, 'en')).sentence()).toBe(text);
  });

  it.each([
    ['2027-01-15', 'ITP valabil până în ianuarie 2027'],
    ['2027-12-31', 'ITP valabil până în decembrie 2027'],
    ['2026-12-31', 'ITP valabil până în decembrie 2026'],
  ])('names the month of %s in Romanian', async (expiry, text) => {
    expect((await render(expiry)).sentence()).toBe(text);
  });

  it.each([
    ['2027-01-01', 'ITP valid until January 2027'],
    ['2027-12-31', 'ITP valid until December 2027'],
  ])('names the month of %s in English', async (expiry, text) => {
    expect((await render(expiry, 'en')).sentence()).toBe(text);
  });

  it.each([
    [
      '2026-01-01',
      'ITP‑ul a expirat pe 1 ian. 2026',
      'ITP expired on 1 Jan 2026',
    ],
    [
      '2020-02-29',
      'ITP‑ul a expirat pe 29 feb. 2020',
      'ITP expired on 29 Feb 2020',
    ],
    [
      '2025-12-31',
      'ITP‑ul a expirat pe 31 dec. 2025',
      'ITP expired on 31 Dec 2025',
    ],
  ])('writes the passed day %s in both languages', async (expiry, ro, en) => {
    expect((await render(expiry)).sentence()).toBe(ro);
    TestBed.resetTestingModule();
    expect((await render(expiry, 'en')).sentence()).toBe(en);
  });

  it.each([undefined, '', 'soon', '2026-02-30', '2026-10-09T10:00:00Z'])(
    'shows the grey line for %p',
    async (expiry) => {
      const line = await render(
        expiry as unknown as string | null,
        'ro',
        GARAGES,
      );

      expect(line.state()).toBe('grey');
      expect(line.sentence()).toBe('ITP: adaugă data din talon');
      expect(line.anchors().length).toBe(0);
    },
  );

  it('keeps the dot hidden in every state', async () => {
    for (const expiry of [
      null,
      '2026-10-01',
      '2026-10-08',
      '2026-10-20',
      '2027-10-01',
    ]) {
      TestBed.resetTestingModule();
      const line = await render(expiry);
      expect(
        line.element.querySelector('.mf-lamp-dot')?.getAttribute('aria-hidden'),
      ).toBe('true');
    }
  });

  it('shows no link when one is given but the date has not passed', async () => {
    for (const expiry of [
      '2026-10-08',
      '2026-10-09',
      '2026-10-15',
      '2026-12-31',
    ]) {
      TestBed.resetTestingModule();
      const line = await render(expiry, 'ro', GARAGES);
      expect(line.anchors().length).toBe(0);
    }
  });

  it('shows exactly one link on a passed date', async () => {
    const line = await render('2000-01-01', 'ro', GARAGES);

    expect(line.anchors().length).toBe(1);
  });

  it('encodes a brand with reserved characters in the address', async () => {
    const line = await render('2026-10-07', 'ro', {
      ...GARAGES!,
      query: { brand: 'a&b=c d' },
    });

    expect(line.anchors()[0]?.getAttribute('href')).toBe(
      '/ro/garages?brand=a%26b%3Dc%20d',
    );
  });

  it('keeps the address without a query when none is given', async () => {
    const line = await render('2026-10-07', 'ro', { ...GARAGES!, query: {} });

    expect(line.anchors()[0]?.getAttribute('href')).toBe('/ro/garages');
  });

  it('adds the link when the clock passes the last day, and not before', async () => {
    clockAt('2026-10-08T20:59:59.999Z');
    const line = await render('2026-10-08', 'ro', GARAGES);
    expect(line.anchors().length).toBe(0);

    jest.setSystemTime(new Date('2026-10-08T21:00:00.000Z'));
    redraw(line.fixture);

    expect(line.anchors().length).toBe(1);
  });

  it('turns a green line amber when Bucharest midnight passes with no new input', async () => {
    clockAt('2026-10-08T20:59:59.999Z');
    const line = await render('2026-12-08');
    expect(line.state()).toBe('green');

    jest.setSystemTime(new Date('2026-10-08T21:00:00.000Z'));
    redraw(line.fixture);

    expect(line.state()).toBe('amber');
    expect(line.sentence()).toBe('ITP‑ul expiră în 60 de zile');
  });

  it('follows a changed expiry and drops the link', async () => {
    const line = await render('2026-10-01', 'ro', GARAGES);
    expect(line.anchors().length).toBe(1);

    line.fixture.componentInstance.expiry.set('2027-10-01');
    redraw(line.fixture);

    expect(line.state()).toBe('green');
    expect(line.anchors().length).toBe(0);
  });

  it('follows a date removed after it was set', async () => {
    const line = await render('2026-10-01', 'ro', GARAGES);

    line.fixture.componentInstance.expiry.set(null);
    redraw(line.fixture);

    expect(line.state()).toBe('grey');
    expect(line.anchors().length).toBe(0);
  });

  it('rewrites the sentence and link when the language changes', async () => {
    const line = await render('2026-10-07', 'ro', GARAGES);

    await line.i18n.use('en');
    redraw(line.fixture);

    expect(line.sentence()).toBe('ITP expired on 7 Oct 2026');
    expect(line.anchors()[0]?.textContent?.trim()).toBe('Find a garage');
  });

  it('gives two lines on one page their own dates', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const i18n = TestBed.inject(I18n);
    await i18n.enter('driver');
    const a = TestBed.createComponent(Host);
    const b = TestBed.createComponent(Host);
    a.componentInstance.expiry.set('2026-10-01');
    b.componentInstance.expiry.set('2027-10-01');
    redraw(a);
    redraw(b);

    const state = (f: typeof a) =>
      (f.nativeElement as HTMLElement)
        .querySelector('mf-lamp')
        ?.getAttribute('data-state');
    expect([state(a), state(b)]).toEqual(['red', 'green']);
  });
});
