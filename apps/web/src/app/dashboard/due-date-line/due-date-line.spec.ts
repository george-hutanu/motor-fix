import { ChangeDetectorRef, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { DueDateLine } from './due-date-line';

type Link = {
  label: string;
  name?: string;
  params?: Record<string, string>;
  path: string[];
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

const GARAGES: NonNullable<Link> = {
  label: 'driver.cars.findGarage',
  name: 'driver.cars.findGarageFor',
  params: { car: 'BMW Seria 3' },
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
    anchors: () => element.querySelectorAll('a'),
    element,
    fixture,
    i18n,
    sentence: () => (lamp().textContent ?? '').replace(/\s+/g, ' ').trim(),
    state: () => lamp().getAttribute('data-state'),
  };
}

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

  it('names the car in the link for a screen reader', async () => {
    const line = await render('2026-10-07', 'ro', GARAGES);

    expect(line.anchor()?.getAttribute('aria-label')).toBe(
      'Caută un service pentru BMW Seria 3',
    );
  });

  it('leaves the visible text as the name when no name is given', async () => {
    const { name: _, params: __, ...plain } = GARAGES;
    const line = await render('2026-10-07', 'ro', plain);

    expect(line.anchor()?.hasAttribute('aria-label')).toBe(false);
  });

  it('names the link in English', async () => {
    const line = await render('2026-10-07', 'en', {
      ...GARAGES,
      path: ['/', 'en', 'garages'],
    });

    expect(line.anchor()?.textContent?.trim()).toBe('Find a garage');
    expect(line.anchor()?.getAttribute('href')).toBe('/en/garages?brand=bmw');
    expect(line.anchor()?.getAttribute('aria-label')).toBe(
      'Find a garage for BMW Seria 3',
    );
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

  it.each([
    undefined,
    '',
    'soon',
    ' 2026-10-09',
    '2026-02-30',
    '2026-10-09T10:00:00Z',
  ])('shows the grey line for %p', async (expiry) => {
    const line = await render(
      expiry as unknown as string | null,
      'ro',
      GARAGES,
    );

    expect(line.state()).toBe('grey');
    expect(line.sentence()).toBe('ITP: adaugă data din talon');
    expect(line.anchors().length).toBe(0);
  });

  it.each([
    ['1970-01-01', 'red', 'ITP‑ul a expirat pe 1 ian. 1970'],
    ['9999-12-31', 'green', 'ITP valabil până în decembrie 9999'],
  ])('reads the far date %s as a %s lamp', async (expiry, state, text) => {
    const line = await render(expiry);

    expect(line.state()).toBe(state);
    expect(line.sentence()).toBe(text);
  });

  it.each([
    [
      '2026-10-15',
      'red',
      'ITP‑ul expiră în 7 zile',
      'red',
      'ITP‑ul expiră în 6 zile',
    ],
    [
      '2026-10-16',
      'amber',
      'ITP‑ul expiră în 8 zile',
      'red',
      'ITP‑ul expiră în 7 zile',
    ],
  ])(
    'counts %s again at Bucharest midnight',
    async (expiry, stateBefore, before, stateAfter, after) => {
      clockAt('2026-10-08T20:59:59.999Z');
      const line = await render(expiry);
      expect([line.state(), line.sentence()]).toEqual([stateBefore, before]);

      jest.setSystemTime(new Date('2026-10-08T21:00:00.000Z'));
      redraw(line.fixture);

      expect([line.state(), line.sentence()]).toEqual([stateAfter, after]);
    },
  );

  it.each([
    ['2026-03-23T10:00:00Z', '2026-03-30', 'red', 'ITP‑ul expiră în 7 zile'],
    ['2026-10-18T10:00:00Z', '2026-10-26', 'amber', 'ITP‑ul expiră în 8 zile'],
  ])(
    'keeps the thresholds across a clock change (%s)',
    async (at, expiry, state, text) => {
      clockAt(at);
      const line = await render(expiry);

      expect([line.state(), line.sentence()]).toEqual([state, text]);
    },
  );

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
      ...GARAGES,
      query: { brand: 'a&b=c d' },
    });

    expect(line.anchors()[0]?.getAttribute('href')).toBe(
      '/ro/garages?brand=a%26b%3Dc%20d',
    );
  });

  it('keeps the address without a query when none is given', async () => {
    const line = await render('2026-10-07', 'ro', { ...GARAGES, query: {} });

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
