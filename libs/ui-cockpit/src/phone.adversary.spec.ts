import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HlmTableImports, Layout } from './index';
import { BREAKPOINTS } from './lib/layout';

const css = readFileSync(join(__dirname, 'styles/cockpit.css'), 'utf8');
const flat = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\(\s+/g, '(')
  .replace(/\s+\)/g, ')');

function viewport(start: number) {
  let width = start;
  const lists: { query: string; fns: ((e: { matches: boolean }) => void)[] }[] =
    [];
  const matches = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return (
      (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    );
  };
  window.matchMedia = ((query: string) => {
    const entry = { fns: [] as ((e: { matches: boolean }) => void)[], query };
    lists.push(entry);
    return {
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
        entry.fns.push(fn),
      addListener: (fn: (e: { matches: boolean }) => void) =>
        entry.fns.push(fn),
      get matches() {
        return matches(query);
      },
      media: query,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    };
  }) as unknown as typeof window.matchMedia;
  return async (next: number) => {
    width = next;
    for (const entry of lists)
      for (const fn of entry.fns) fn({ matches: matches(entry.query) });
    await new Promise((resolve) => setTimeout(resolve));
  };
}

describe('layout signal at the edges', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  for (const [width, expected] of [
    [0, 'phone'],
    [1, 'phone'],
    [767.5, 'phone'],
    [767.99, 'phone'],
    [768.01, 'tablet'],
    [1023.99, 'tablet'],
    [1024.01, 'desktop'],
    [100000, 'desktop'],
  ] as const) {
    it(`says ${expected} at ${width} px`, () => {
      viewport(width);

      expect(TestBed.inject(Layout).current()).toBe(expected);
    });
  }

  it('settles on the last width after a burst of resizes across both breakpoints', async () => {
    const resize = viewport(320);
    const layout = TestBed.inject(Layout);

    for (const width of [1200, 700, 900, 320, 1024, 767, 768])
      await resize(width);

    expect(layout.current()).toBe('tablet');
  });

  it('gives every reader the same answer after a resize', async () => {
    const resize = viewport(1200);
    const first = TestBed.inject(Layout);
    const second = TestBed.inject(Layout);

    await resize(500);

    expect([first.current(), second.current()]).toEqual(['phone', 'phone']);
    expect(first).toBe(second);
  });

  it('agrees with the phone rules of the stylesheet at every width around the breakpoint', async () => {
    const phoneBelow = Number(
      /@media not all and \(min-width: ([\d.]+)px\)/.exec(flat)?.[1] ??
        Number.NaN,
    );
    const resize = viewport(320);
    const layout = TestBed.inject(Layout);

    for (const width of [
      BREAKPOINTS.tablet - 0.5,
      BREAKPOINTS.tablet - 0.02,
      BREAKPOINTS.tablet - 0.01,
      BREAKPOINTS.tablet - 0.001,
      BREAKPOINTS.tablet,
    ]) {
      await resize(width);
      expect([width, width < phoneBelow]).toEqual([
        width,
        layout.current() === 'phone',
      ]);
    }
  });
});

@Component({
  imports: [HlmTableImports],
  template: `
    <table hlmTable>
      <tbody hlmTBody>
        @for (row of rows(); track row) {
          <tr hlmTr>
            <td hlmTd [column]="main()">{{ row }}</td>
            <td hlmTd [column]="key()">x</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
class DynamicTable {
  readonly main = signal<'main' | 'key' | null | undefined>('main');
  readonly key = signal<'main' | 'key' | null | undefined>('key');
  readonly rows = signal(['a']);
}

describe('table column roles', () => {
  const cells = (host: HTMLElement) =>
    [...host.querySelectorAll('td')].map((td) =>
      td.getAttribute('data-column'),
    );

  it('drops the role attribute when the column is set to null or undefined', async () => {
    const fixture = TestBed.createComponent(DynamicTable);
    await fixture.whenStable();
    expect(cells(fixture.nativeElement)).toEqual(['main', 'key']);

    fixture.componentInstance.main.set(null);
    fixture.componentInstance.key.set(undefined);
    await fixture.whenStable();

    expect(cells(fixture.nativeElement)).toEqual([null, null]);
  });

  it('follows a column that changes role', async () => {
    const fixture = TestBed.createComponent(DynamicTable);
    await fixture.whenStable();

    fixture.componentInstance.main.set('key');
    fixture.componentInstance.key.set('main');
    await fixture.whenStable();

    expect(cells(fixture.nativeElement)).toEqual(['key', 'main']);
  });

  it('marks every one of a thousand rows', async () => {
    const fixture = TestBed.createComponent(DynamicTable);
    fixture.componentInstance.rows.set(
      Array.from({ length: 1000 }, (_, i) => `row ${i}`),
    );
    await fixture.whenStable();

    const marked = fixture.nativeElement.querySelectorAll(
      'td[data-column="main"]',
    );
    expect(marked).toHaveLength(1000);
  });

  it('marks the cells of an empty table body as nothing at all', async () => {
    const fixture = TestBed.createComponent(DynamicTable);
    fixture.componentInstance.rows.set([]);
    await fixture.whenStable();

    expect(
      fixture.nativeElement.querySelectorAll('[data-column]'),
    ).toHaveLength(0);
  });
});

describe('phone stylesheet rules', () => {
  const phoneStart = flat.indexOf('@media not all and (min-width:');
  const phone = flat.slice(phoneStart, flat.indexOf('@media', phoneStart + 1));

  it('only ever collapses a table that names a main column', () => {
    const selectors = [...phone.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((s) => s.includes('spartan-table'));

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect([
          part.trim(),
          part.includes(':has([data-column="main"])'),
        ]).toEqual([part.trim(), true]);
      }
    }
  });

  it('hides a row header cell that is not main or key, not only data cells', () => {
    const hiding = [...phone.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /display:\s*none/.test(body))
      .map(([, selector]) => selector);

    expect(
      hiding.some((selector) => /\.spartan-table-head(?![\w-])/.test(selector)),
    ).toBe(true);
  });

  it('declares every text size from the type tokens or at 12 px or more', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    );

    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      const ok =
        /^var\(--mf-size-[a-z]+\)$/.test(size) ||
        (/^\d+(\.\d+)?px$/.test(size) && Number.parseFloat(size) >= 12);
      expect([size, ok]).toEqual([size, true]);
    }
  });

  it('never hides sideways overflow on the page instead of fixing it', () => {
    expect(flat).not.toMatch(
      /(?:^|[}\s,])(?:html|body)\s*\{[^}]*overflow(?:-x)?:\s*hidden/,
    );
  });

  it('lets a table that names no main column scroll inside its own container', () => {
    expect(flat).toMatch(/\.spartan-table-container \{[^}]*overflow-x:\s*auto/);
  });
});
