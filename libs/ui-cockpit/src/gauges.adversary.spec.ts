import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { Lamp, Odometer, RatingDial } from './index';

@Component({
  imports: [Lamp, RatingDial, Odometer],
  template: `
    <mf-lamp [state]="$any(state())" [label]="label()" [pulse]="pulse()" />
    <mf-rating-dial [value]="value()" [size]="size()" />
    <mf-odometer [from]="from()" [to]="to()" />
  `,
})
class Host {
  readonly state = signal<unknown>('green');
  readonly label = signal('Lucrează pe Dacia');
  readonly pulse = signal(false);
  readonly value = signal<unknown>(4.8);
  readonly size = signal<'large' | 'small'>('large');
  readonly from = signal<unknown>(125000);
  readonly to = signal<unknown>(160000);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const host = fixture.componentInstance;
  const lamp = () => root.querySelector('mf-lamp') as HTMLElement;
  const dial = () => root.querySelector('mf-rating-dial') as HTMLElement;
  const odo = () => root.querySelector('mf-odometer') as HTMLElement;
  return {
    centre: () => dial().querySelector('.mf-dial-value')?.textContent?.trim(),
    dial,
    digits: () => [...odo().querySelectorAll('.mf-odometer-digit')],
    fill: () => Number(dial().style.getPropertyValue('--mf-dial-fill')),
    fixture,
    host,
    lamp,
    live: () => [...odo().querySelectorAll('[aria-live]')],
    odo,
    poke: () => fixture.detectChanges(),
    spoken: () =>
      odo().querySelector('[aria-live]')?.textContent?.trim() as string,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('gauges exports', () => {
  it('exports the three parts from the library entry point', () => {
    expect([typeof Lamp, typeof RatingDial, typeof Odometer]).toEqual([
      'function',
      'function',
      'function',
    ]);
  });
});

describe('lamp with hostile input', () => {
  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'GREEN',
    ' green',
    '',
    null,
    undefined,
    42,
  ])('shows grey for the state %p', (state) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const t = render();

    t.host.state.set(state);
    t.poke();

    expect(t.lamp().getAttribute('data-state')).toBe('grey');
  });

  it('warns once per distinct unknown value, and not again for the same value', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const t = render();

    t.host.state.set('purple');
    t.poke();
    t.poke();
    t.host.pulse.set(true);
    t.poke();
    expect(warn).toHaveBeenCalledTimes(1);

    t.host.state.set('teal');
    t.poke();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not warn for any of the four valid states', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const t = render();

    for (const state of ['red', 'amber', 'grey', 'green']) {
      t.host.state.set(state);
      t.poke();
    }

    expect(warn).not.toHaveBeenCalled();
  });

  it('renders markup in a label as plain text', () => {
    const t = render();

    t.host.label.set('<b onclick="x()">Nu ia Dacia</b>');
    t.poke();

    expect(t.lamp().textContent?.trim()).toBe(
      '<b onclick="x()">Nu ia Dacia</b>',
    );
    expect(t.lamp().querySelector('b')).toBeNull();
  });

  it('follows a label change and keeps the dot hidden from screen readers', () => {
    const t = render();

    t.host.label.set('Ținută la zi — 🚗');
    t.poke();

    expect(t.lamp().textContent?.trim()).toBe('Ținută la zi — 🚗');
    expect(
      t.lamp().querySelector('.mf-lamp-dot')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('removes the pulse marker again and never changes the state for it', () => {
    const t = render();

    t.host.pulse.set(true);
    t.poke();
    expect(t.lamp().hasAttribute('data-pulse')).toBe(true);

    t.host.pulse.set(false);
    t.poke();
    expect(t.lamp().hasAttribute('data-pulse')).toBe(false);
    expect(t.lamp().getAttribute('data-state')).toBe('green');
  });
});

describe('rating dial rounding and clamping', () => {
  it.each([
    [1.15, '1,2'],
    [2.45, '2,5'],
    [2.65, '2,7'],
    [4.35, '4,4'],
    [0.35, '0,4'],
    [3.05, '3,1'],
    [4.95, '5,0'],
    [4.949, '4,9'],
    [0.05, '0,1'],
    [1, '1,0'],
    [5, '5,0'],
  ])('reads %p as %s, rounding half up on the decimal as written', (v, text) => {
    const t = render();

    t.host.value.set(v);
    t.poke();

    expect(t.centre()).toBe(text);
  });

  it.each([
    5.04, 5.05, 100, 1e308,
  ])('clamps %p to a full arc reading 5,0', (v) => {
    const t = render();

    t.host.value.set(v);
    t.poke();

    expect(t.centre()).toBe('5,0');
    expect(t.fill()).toBe(1);
  });

  it.each<unknown>([
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    -1e308,
    0.049,
    '',
    ' ',
    '5',
    true,
    false,
    [],
    [4.8],
    {},
    { valueOf: () => 4.8 },
    Number.MIN_VALUE,
  ])('reads %p as no rating', (v) => {
    const t = render();

    t.host.value.set(v);
    t.poke();

    expect(t.centre()).toBe('—');
    expect(t.fill()).toBe(0);
    expect(t.dial().getAttribute('aria-label')).toBe('Nicio recenzie încă');
  });

  it('fills value over five of the arc for a mid value', () => {
    const t = render();

    t.host.value.set(2.5);
    t.poke();

    expect(t.fill()).toBeCloseTo(0.5);
  });

  it('shows a rating of 0,05 as 0,1 and not as no rating', () => {
    const t = render();

    t.host.value.set(0.05);
    t.poke();

    expect(t.centre()).toBe('0,1');
    expect(t.dial().getAttribute('aria-label')).toBe('Rating 0,1 din 5');
  });

  it('returns to the same output after going through no rating and back', () => {
    const t = render();
    const before = [t.centre(), t.dial().getAttribute('aria-label'), t.fill()];

    t.host.value.set(null);
    t.poke();
    t.host.value.set(4.8);
    t.poke();

    expect([t.centre(), t.dial().getAttribute('aria-label'), t.fill()]).toEqual(
      before,
    );
  });
});

describe('rating dial accessible name and language', () => {
  it('keeps one name on the host and hides everything inside it', () => {
    const t = render();

    const named = [...t.dial().querySelectorAll('[aria-label]')].filter(
      (el) => el.getAttribute('aria-hidden') !== 'true',
    );
    expect(named).toEqual([]);
    expect(t.dial().getAttribute('aria-label')).toBe('Rating 4,8 din 5');
    expect(t.dial().querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('keeps the small dial named in the same way', () => {
    const t = render();

    t.host.size.set('small');
    t.poke();

    expect(t.dial().getAttribute('aria-label')).toBe('Rating 4,8 din 5');
    expect(t.dial().querySelector('.mf-dial-needle')).toBeNull();
  });

  it('switches language in place on the same elements, and back again', async () => {
    const t = render();
    const dialBefore = t.dial();
    const valueNode = dialBefore.querySelector('.mf-dial-value');
    const i18n = TestBed.inject(I18n);

    await i18n.use('en');
    t.poke();
    expect([t.centre(), t.dial().getAttribute('aria-label')]).toEqual([
      '4.8',
      'Rating 4.8 out of 5',
    ]);
    expect(t.dial()).toBe(dialBefore);
    expect(t.dial().querySelector('.mf-dial-value')).toBe(valueNode);

    await i18n.use('ro');
    t.poke();
    expect([t.centre(), t.dial().getAttribute('aria-label')]).toEqual([
      '4,8',
      'Rating 4,8 din 5',
    ]);
  });

  it('reads a clamped 7 in English as 5.0 out of 5', async () => {
    const t = render();

    t.host.value.set(7);
    await TestBed.inject(I18n).use('en');
    t.poke();

    expect(t.dial().getAttribute('aria-label')).toBe('Rating 5.0 out of 5');
  });
});

describe('odometer amounts', () => {
  it.each([
    [250, undefined, '3 lei'],
    [149, undefined, '1 lei'],
    [150, undefined, '2 lei'],
    [100050, undefined, '1.001 lei'],
    [100049, undefined, '1.000 lei'],
    [100, undefined, '1 lei'],
    [99999999949, undefined, '999.999.999 lei'],
    [125000, 125049, '1.250 lei'],
    [125049, 125000, '1.250 lei'],
  ])('shows %p to %p as "%s"', (from, to, text) => {
    const t = render();

    t.host.from.set(from);
    t.host.to.set(to);
    t.poke();

    expect(t.spoken()).toBe(text);
  });

  it.each([
    [null, 160000],
    [undefined, 160000],
    [125000, null],
    [Number.NaN, 160000],
    [125000, Number.NaN],
    [null, null],
    [undefined, undefined],
  ])('shows "—" for the range %p to %p', (from, to) => {
    const t = render();

    t.host.from.set(from);
    t.host.to.set(to);
    t.poke();

    expect(t.spoken()).toBe('—');
    expect(t.digits()).toEqual([]);
  });

  it('keeps exactly one live region in every state', () => {
    const t = render();
    const states: [unknown, unknown][] = [
      [125000, 160000],
      [140050, undefined],
      [undefined, undefined],
      [null, 160000],
      [80010, 79990],
    ];

    for (const [from, to] of states) {
      t.host.from.set(from);
      t.host.to.set(to);
      t.poke();
      expect(t.live()).toHaveLength(1);
      expect(t.live()[0].getAttribute('aria-live')).toBe('polite');
      expect(t.live()[0].getAttribute('aria-atomic')).toBe('true');
      expect(t.live()[0].getAttribute('aria-hidden')).not.toBe('true');
    }
  });

  it('updates the same live region element rather than replacing it', () => {
    const t = render();
    const region = t.live()[0];

    t.host.from.set(140000);
    t.host.to.set(180000);
    t.poke();
    t.host.from.set(undefined);
    t.host.to.set(undefined);
    t.poke();

    expect(t.live()[0]).toBe(region);
    expect(region.textContent?.trim()).toBe('—');
  });

  it('puts no digit cell inside the live region and hides every digit from screen readers', () => {
    const t = render();

    expect(t.live()[0].querySelector('.mf-odometer-digit')).toBeNull();
    for (const cell of t.digits())
      expect(cell.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('odometer digit cells', () => {
  const carried = (t: ReturnType<typeof render>) =>
    t
      .digits()
      .map((d) => (d as HTMLElement).style.getPropertyValue('--mf-digit'));

  it('has one cell per digit for a single value and none for the separator or unit', () => {
    const t = render();

    t.host.from.set(140050);
    t.host.to.set(undefined);
    t.poke();

    expect(t.digits().map((d) => d.textContent)).toEqual(['1', '4', '0', '1']);
    expect(carried(t)).toEqual(['1', '4', '0', '1']);
  });

  it('renders a zero as one cell carrying 0', () => {
    const t = render();

    t.host.from.set(0);
    t.host.to.set(undefined);
    t.poke();

    expect(t.digits().map((d) => d.textContent)).toEqual(['0']);
  });

  it('has one cell per digit of a nine-digit amount', () => {
    const t = render();

    t.host.from.set(99999999949);
    t.host.to.set(undefined);
    t.poke();

    expect(t.digits()).toHaveLength(9);
  });

  it('holds the same digits in English as in Romanian', async () => {
    const t = render();
    const ro = t.digits().map((d) => d.textContent);

    await TestBed.inject(I18n).use('en');
    t.poke();

    expect(t.digits().map((d) => d.textContent)).toEqual(ro);
    expect(t.spoken()).toBe('1,250–1,600 lei');
  });

  it('drops cells when the value gets shorter and carries the new digits', () => {
    const t = render();

    t.host.from.set(90000);
    t.host.to.set(undefined);
    t.poke();

    expect(t.digits().map((d) => d.textContent)).toEqual(['9', '0', '0']);
    expect(carried(t)).toEqual(['9', '0', '0']);
  });
});

describe('odometer language switch', () => {
  it('re-renders in place for every case and back to Romanian', async () => {
    const t = render();
    const odoBefore = t.odo();
    const i18n = TestBed.inject(I18n);

    await i18n.use('en');
    t.poke();
    expect(t.spoken()).toBe('1,250–1,600 lei');
    expect(t.odo()).toBe(odoBefore);

    t.host.from.set(undefined);
    t.host.to.set(undefined);
    t.poke();
    expect(t.spoken()).toBe('—');

    t.host.from.set(140050);
    t.poke();
    expect(t.spoken()).toBe('1,401 lei');

    await i18n.use('ro');
    t.poke();
    expect(t.spoken()).toBe('1.401 lei');
  });
});

describe('gauge texts in the shared i18n files', () => {
  const read = (area: string, lang: string) =>
    JSON.parse(
      readFileSync(
        join(__dirname, '../../i18n/src', area, `${lang}.json`),
        'utf8',
      ),
    );

  it('has the dial phrases with a value placeholder in both languages', () => {
    for (const lang of ['ro', 'en']) {
      const { gauge } = read('shell', lang);
      expect(gauge.rating).toContain('{value}');
      expect(gauge.none.trim()).not.toBe('');
    }
    expect(read('shell', 'en').gauge).toEqual({
      none: 'No reviews yet',
      rating: 'Rating {value} out of 5',
    });
  });

  it('has the same catalogue keys in Romanian and English, none empty', () => {
    const flatten = (o: Record<string, unknown>, p = ''): [string, unknown][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? flatten(v as Record<string, unknown>, `${p}${k}.`)
          : [[`${p}${k}`, v] as [string, unknown]],
      );
    const ro = flatten(read('cockpit', 'ro').gauges);
    const en = flatten(read('cockpit', 'en').gauges);

    expect(ro.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
    expect(ro.length).toBeGreaterThan(0);
    expect(
      [...ro, ...en].filter(
        ([, v]) => typeof v !== 'string' || v.trim() === '',
      ),
    ).toEqual([]);
  });
});
