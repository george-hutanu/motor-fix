import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Lamp, Odometer, Panel, REDUCED_MOTION } from './index';

const QUERY = '(prefers-reduced-motion: reduce)';
const css = readFileSync(join(__dirname, 'styles', 'cockpit.css'), 'utf8');

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|css)$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}
const shipped = sourcesUnder(__dirname).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

function device(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    addEventListener: (_: string, l: never) => listeners.add(l),
    matches: initial,
    media: QUERY,
    removeEventListener: (_: string, l: never) => listeners.delete(l),
  };
  jest
    .spyOn(window, 'matchMedia')
    .mockImplementation((q) =>
      q === QUERY
        ? (media as unknown as MediaQueryList)
        : ({ matches: false, media: q } as MediaQueryList),
    );
  return {
    listeners,
    set(next: boolean) {
      media.matches = next;
      for (const l of [...listeners])
        l({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('the shared reduced-motion signal from the outside', () => {
  const read = () =>
    TestBed.runInInjectionContext(() => inject(REDUCED_MOTION));

  it('is false when the document has no window', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }],
    });

    expect(read()()).toBe(false);
  });

  it('is false when the window has no matchMedia', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: {} } }],
    });

    expect(read()()).toBe(false);
  });

  it('is false when the query reports no match value', () => {
    jest.spyOn(window, 'matchMedia').mockReturnValue({
      addEventListener() {},
      matches: undefined,
      removeEventListener() {},
    } as unknown as MediaQueryList);

    expect(read()()).toBe(false);
  });

  it('cannot be written to by a consumer', () => {
    device(false);
    const reduced = read() as unknown as { set?: unknown; update?: unknown };

    expect(reduced.set).toBeUndefined();
    expect(reduced.update).toBeUndefined();
  });

  it('settles on the last of many rapid changes with one listener', () => {
    const dev = device(false);
    const reduced = read();

    for (let i = 0; i < 1001; i++) dev.set(i % 2 === 0);

    expect(reduced()).toBe(true);
    expect(dev.listeners.size).toBe(1);
  });

  it('stops listening and keeps its last value once its injector is destroyed', () => {
    const dev = device(false);
    const reduced = read();
    dev.set(true);

    TestBed.resetTestingModule();

    expect(dev.listeners.size).toBe(0);
    expect(reduced()).toBe(true);
    dev.set(false);
    expect(reduced()).toBe(true);
  });
});

describe('the reduced-motion rule', () => {
  const at = css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  const tail = css.slice(at);

  it('stills elements and both pseudo-elements with important declarations', () => {
    for (const selector of ['*', '*::before', '*::after'])
      expect(tail).toContain(selector);
    expect(tail).toMatch(/animation:\s*none\s*!important/);
    expect(tail).toMatch(/transition:\s*none\s*!important/);
  });

  it('is the only motion media block and sits at the top level of the sheet', () => {
    expect(css.match(/prefers-reduced-motion/g)).toHaveLength(1);
    const before = css.slice(0, at);
    expect((before.match(/{/g) ?? []).length).toBe(
      (before.match(/}/g) ?? []).length,
    );
  });

  it('is not undone by an important animation or transition anywhere else', () => {
    const rule = /(animation|transition)[\w-]*\s*:[^;]*!important/;
    for (const { path, text } of shipped) {
      const scanned = path.endsWith('cockpit.css') ? text.slice(0, at) : text;
      expect({ found: rule.test(scanned), path }).toEqual({
        found: false,
        path,
      });
    }
  });

  it('never gates motion on a no-preference query', () => {
    for (const { path, text } of shipped)
      expect({
        found: /prefers-reduced-motion:\s*no-preference/.test(text),
        path,
      }).toEqual({ found: false, path });
  });
});

describe('motion declarations across the kit', () => {
  const declared = shipped.flatMap(({ path, text }) =>
    [...text.matchAll(/(?<![\w-])(animation|transition)\s*:\s*([^;`]+);/g)].map(
      ([, property, value]) => ({ path, property, value: value.trim() }),
    ),
  );

  it('takes every duration from a token, except the switch slide and the reset', () => {
    const literal = declared.filter(
      ({ value }) =>
        !value.includes('var(--mf-motion-') &&
        value !== 'none !important' &&
        value !== 'transform 0.15s ease-out',
    );

    expect(literal).toEqual([]);
  });

  it('sends the one-shot motion through the shared curve and never holds its end state', () => {
    const oneShot = declared.filter(({ value }) =>
      /--mf-motion-(rise|pop|dial|roll)\b/.test(value),
    );

    expect(oneShot.length).toBeGreaterThanOrEqual(5);
    for (const { value } of oneShot) {
      expect(value).toContain('var(--mf-motion-ease)');
      expect(value).not.toMatch(/\b(forwards|both|infinite)\b/);
    }
  });

  it('repeats only the pulse and the blink', () => {
    const repeating = declared.filter(({ value }) =>
      /\binfinite\b/.test(value),
    );

    expect(repeating.map(({ value }) => value.split(' ')[0]).sort()).toEqual([
      'mf-blink',
      'mf-pulse',
    ]);
  });

  it('keeps the repeating periods at one second or longer', () => {
    for (const name of ['--mf-motion-pulse', '--mf-motion-blink']) {
      const [, n, unit] = new RegExp(`${name}:\\s*([\\d.]+)(ms|s)`).exec(
        css,
      ) as RegExpExecArray;
      expect(Number(n) * (unit === 's' ? 1000 : 1)).toBeGreaterThanOrEqual(
        1000,
      );
    }
  });

  it('makes the blink step rather than fade, and cut to 0.35', () => {
    expect(css).toMatch(/\.mf-blink\s*{[^}]*steps\(1,\s*end\)[^}]*infinite/);
    expect(css).toMatch(/@keyframes mf-blink\s*{\s*50%\s*{\s*opacity:\s*0\.35/);
  });

  it('moves only opacity and transform in the keyframes, never hiding a control', () => {
    const frames = [...css.matchAll(/@keyframes [\w-]+\s*{([\s\S]*?)\n}/g)];

    expect(frames).toHaveLength(5);
    for (const [, body] of frames)
      expect(body).not.toMatch(
        /visibility|display|pointer-events|filter|blur|height|width/,
      );
  });

  it('starts rise and pop from the stated values', () => {
    expect(css).toMatch(
      /@keyframes mf-rise\s*{\s*from\s*{\s*opacity:\s*0;\s*transform:\s*translateY\(14px\)/,
    );
    expect(css).toMatch(
      /@keyframes mf-pop\s*{\s*from\s*{\s*opacity:\s*0;\s*transform:\s*scale\(0\.94\)/,
    );
  });

  it('gives no animation to a closing dialog or sheet', () => {
    for (const { path, text } of shipped)
      expect({
        found: /data-state=["']?closed[^{]*{[^}]*animation/.test(text),
        path,
      }).toEqual({ found: false, path });
  });

  it('pops sheets from the edge they are anchored to', () => {
    expect(css).toMatch(
      /data-side="right"\]\s*{\s*transform-origin:\s*right center/,
    );
    expect(css).toMatch(
      /data-side="left"\]\s*{\s*transform-origin:\s*left center/,
    );
    expect(css).toMatch(
      /data-side="bottom"\]\s*{\s*transform-origin:\s*center bottom/,
    );
  });

  it('lays a bottom sheet on the bottom edge, full width, rounded and bordered on top only', () => {
    const at = css.indexOf('.spartan-sheet-content[data-side="bottom"] {');
    const bottom = css.slice(at, css.indexOf('}', at));

    expect(at).toBeGreaterThan(-1);
    expect(bottom).toMatch(/inset-block:\s*auto 0;/);
    expect(bottom).toMatch(/inset-inline:\s*0;/);
    expect(bottom).toMatch(/width:\s*auto;/);
    expect(bottom).toMatch(/border-width:\s*1px 0 0;/);
    expect(bottom).toMatch(
      /border-radius:\s*var\(--mf-radius-panel\) var\(--mf-radius-panel\) 0 0;/,
    );
  });
});

@Component({
  imports: [Panel, Lamp, Odometer],
  template: `
    <div id="a">
      @for (n of count(); track n) {
        <mf-panel [heading]="'p' + n">{{ body() }}</mf-panel>
      }
    </div>
    <mf-lamp state="green" label="Lucrează" [pulse]="pulse()" />
    <mf-odometer [from]="from()" [to]="to()" />
  `,
})
class Host {
  readonly count = signal<number[]>([1, 2, 3]);
  readonly body = signal('x');
  readonly pulse = signal<unknown>(false);
  readonly from = signal<unknown>(125000);
  readonly to = signal<unknown>(160000);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
  };
}

const sheetText = () =>
  ['panel.ts', 'lamp.ts', 'odometer.ts']
    .map((file) => readFileSync(join(__dirname, 'lib', file), 'utf8'))
    .join('\n');

describe('panel build-up', () => {
  it('declares stagger steps for children 2 to 11, and the last step for the twelfth on, 11 steps at most', () => {
    render();
    const steps = [
      ...sheetText().matchAll(
        /:nth-child\((\d+) of mf-panel\)[^{]*{[^}]*--mf-panel-step:\s*(\d+)/g,
      ),
    ];

    expect(steps.map(([, nth, step]) => [Number(nth), Number(step)])).toEqual(
      Array.from({ length: 10 }, (_, i) => [i + 2, i + 1]),
    );
    expect(sheetText()).toMatch(
      /:nth-child\(n \+ 12 of mf-panel\)\)[^{]*{[^}]*--mf-panel-step:\s*11;/,
    );
  });

  it('keeps the longest delay plus the rise within 1.5 seconds', () => {
    expect(css).toMatch(/--mf-motion-stagger:\s*60ms/);
    expect(css).toMatch(/--mf-motion-rise:\s*700ms/);
    expect(11 * 60 + 700).toBeLessThanOrEqual(1500);
  });

  it('keeps the panel element when its content changes, so nothing replays', () => {
    const { fixture, host, root } = render();
    const before = root.querySelector('#a mf-panel');

    host.body.set('changed');
    fixture.detectChanges();

    expect(root.querySelector('#a mf-panel')).toBe(before);
    expect(before?.textContent).toContain('changed');
  });

  it('renders a thousand panels without losing any', () => {
    const { fixture, host, root } = render();

    host.count.set(Array.from({ length: 1000 }, (_, i) => i));
    fixture.detectChanges();

    expect(root.querySelectorAll('#a mf-panel')).toHaveLength(1000);
  });
});

describe('lamp pulse marker', () => {
  const lamp = (root: HTMLElement) =>
    root.querySelector('mf-lamp') as HTMLElement;

  it.each([
    [false, null],
    [true, ''],
    ['', ''],
    ['false', null],
    [undefined, null],
    [null, null],
  ])('marks pulse=%p as %p', (value, expected) => {
    const { fixture, host, root } = render();

    host.pulse.set(value);
    fixture.detectChanges();

    expect(lamp(root).getAttribute('data-pulse')).toBe(expected);
  });

  it('animates the dot only, never the label or the whole lamp', () => {
    const { root } = render();

    expect(root.querySelector('.mf-lamp-dot')?.textContent).toBe('');
    expect(lamp(root).textContent?.trim()).toBe('Lucrează');
    expect(sheetText()).toMatch(
      /:host\(\[data-pulse\]\) \.mf-lamp-dot[^{]*{[^}]*mf-pulse/,
    );
    expect(sheetText()).not.toMatch(
      /:host\(\[data-pulse\]\)\s*{[^}]*animation/,
    );
  });
});

describe('odometer digit cells', () => {
  const cells = (root: HTMLElement) => [
    ...root.querySelectorAll<HTMLElement>('.mf-odometer-digit'),
  ];
  const positions = (root: HTMLElement) =>
    cells(root).map((c) => c.style.getPropertyValue('--mf-digit'));

  it('carries each digit as the cell text and as its roll position', () => {
    const { root } = render();

    expect(cells(root).length).toBeGreaterThan(0);
    expect(positions(root)).toEqual(
      cells(root).map((c) => c.textContent?.trim()),
    );
  });

  it('keeps the same cell element when a digit changes so the roll can run', () => {
    const { fixture, host, root } = render();
    const before = cells(root);

    host.from.set(135000);
    fixture.detectChanges();
    const after = cells(root);

    expect(after).toHaveLength(before.length);
    expect(after.every((cell, i) => cell === before[i])).toBe(true);
    expect(positions(root)[1]).toBe('3');
  });

  it('moves a cell from 9 back to 0 by changing its position', () => {
    const { fixture, host, root } = render();
    host.to.set(undefined);
    host.from.set(9000);
    fixture.detectChanges();
    const nine = cells(root);

    host.from.set(0);
    fixture.detectChanges();

    expect(positions(root)).toEqual(['0']);
    expect(nine.length).toBeGreaterThan(1);
  });

  it('reads out only the new value after a change', () => {
    const { fixture, host, root } = render();
    const spoken = () => root.querySelector('[aria-live]')?.textContent;

    host.from.set(140000);
    host.to.set(180000);
    fixture.detectChanges();

    expect(spoken()).toContain('1.400');
    expect(spoken()).not.toContain('1.250');
  });

  it('hides the rolling cells from assistive technology', () => {
    const { root } = render();

    expect(
      root.querySelector('.mf-odometer-value')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('shows plain digits in forced colours by dropping the column', () => {
    render();

    expect(sheetText()).toMatch(
      /forced-colors:\s*active\)\s*{[\s\S]*?\.mf-odometer-digit::before\s*{\s*content:\s*none/,
    );
  });

  it('shows the dash and no cells for missing values', () => {
    const { fixture, host, root } = render();

    host.from.set(null);
    host.to.set(null);
    fixture.detectChanges();

    expect(cells(root)).toHaveLength(0);
    expect(root.querySelector('[aria-live]')?.textContent).toContain('—');
  });
});
