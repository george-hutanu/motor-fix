import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HlmTableImports } from './table';

const css = readFileSync(join(__dirname, '../../styles/cockpit.css'), 'utf8');

function blockAfter(source: string, opener: RegExp): string {
  const match = opener.exec(source);
  if (!match) throw new Error(`no block for ${opener}`);
  let depth = 0;
  const start = source.indexOf('{', match.index);
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start + 1, i);
  }
  throw new Error(`unclosed block for ${opener}`);
}

const flat = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\(\s+/g, '(')
  .replace(/\s+\)/g, ')');
const phone = blockAfter(flat, /@media not all and \(min-width:\s*768px\)\s*/);
const outsidePhone = flat.replace(phone, '');

function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function rulesOf(source: string): { selector: string; body: string }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({ body, selector: selector.trim() }),
  );
}

@Component({
  imports: [HlmTableImports],
  template: `
    <table hlmTable>
      <thead hlmTHead>
        <tr hlmTr>
          <th hlmTh [column]="first()">Service</th>
          <th hlmTh>Zona</th>
        </tr>
      </thead>
      <tbody hlmTBody>
        @for (n of rows(); track n) {
          <tr hlmTr>
            <td hlmTd [column]="first()">Row {{ n }}</td>
            <td hlmTd>Zona</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
class Dynamic {
  first = signal<'main' | 'key' | undefined>('main');
  rows = signal<number[]>([]);
}

describe('helm table roles and columns under unusual use', () => {
  it('keeps the table and both row groups when the body has no rows', async () => {
    const fixture = TestBed.createComponent(Dynamic);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('tbody')?.getAttribute('role')).toBe('rowgroup');
    expect(host.querySelector('thead')?.getAttribute('role')).toBe('rowgroup');
    expect(host.querySelectorAll('tbody [role="row"]')).toHaveLength(0);
    expect(host.querySelectorAll('thead [role="row"]')).toHaveLength(1);
  });

  it('gives every one of a thousand rows its row and cell roles', async () => {
    const fixture = TestBed.createComponent(Dynamic);
    fixture.componentInstance.rows.set(
      Array.from({ length: 1000 }, (_, i) => i),
    );
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('tbody tr[role="row"]')).toHaveLength(1000);
    expect(host.querySelectorAll('tbody td[role="cell"]')).toHaveLength(2000);
    expect(host.querySelectorAll('tbody tr:not([role="row"])')).toHaveLength(0);
  });

  it('keeps the role when a column changes or is cleared', async () => {
    const fixture = TestBed.createComponent(Dynamic);
    fixture.componentInstance.rows.set([1]);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const th = host.querySelector('th') as HTMLElement;
    const td = host.querySelector('td') as HTMLElement;

    expect(th.getAttribute('data-column')).toBe('main');
    fixture.componentInstance.first.set('key');
    await fixture.whenStable();
    expect([
      th.getAttribute('data-column'),
      td.getAttribute('data-column'),
    ]).toEqual(['key', 'key']);
    expect([th.getAttribute('role'), td.getAttribute('role')]).toEqual([
      'columnheader',
      'cell',
    ]);

    fixture.componentInstance.first.set(undefined);
    await fixture.whenStable();
    expect(th.hasAttribute('data-column')).toBe(false);
    expect(td.hasAttribute('data-column')).toBe(false);
    expect([th.getAttribute('role'), td.getAttribute('role')]).toEqual([
      'columnheader',
      'cell',
    ]);
  });

  it('carries the classes the phone stylesheet targets on every element', async () => {
    const fixture = TestBed.createComponent(Dynamic);
    fixture.componentInstance.rows.set([1]);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const has = (selector: string, cls: string) =>
      [...host.querySelectorAll(selector)].every((el) =>
        el.classList.contains(cls),
      );

    expect(
      host.querySelector('thead')?.classList.contains('spartan-table-header'),
    ).toBe(true);
    expect(
      host.querySelector('tbody')?.classList.contains('spartan-table-body'),
    ).toBe(true);
    expect(has('table', 'spartan-table')).toBe(true);
    expect(has('tr', 'spartan-table-row')).toBe(true);
    expect(has('th', 'spartan-table-head')).toBe(true);
    expect(has('td', 'spartan-table-cell')).toBe(true);
  });
});

describe('phone stylesheet keeps the header row readable and the layout bounded', () => {
  const phoneRules = rulesOf(phone);
  const targets = (needle: string) =>
    phoneRules.filter((r) => r.selector.includes(needle));

  it('never removes the header row or its row from the accessibility tree on a phone', () => {
    const hiding =
      /display:\s*none|visibility:\s*(hidden|collapse)|content-visibility:\s*hidden|opacity:\s*0\b/;
    const offenders = phoneRules.filter(
      (r) =>
        hiding.test(r.body) &&
        splitSelectors(r.selector).some((part) =>
          /\.spartan-table(-header|-body|-row)?$/.test(
            part.replace(/:has\([^)]*\)/g, ''),
          ),
        ),
    );

    expect(offenders).toEqual([]);
  });

  it('hides only cells and header cells outside main and key, with the same exclusion for both', () => {
    const none = phoneRules.filter((r) => /display:\s*none/.test(r.body));

    expect(none).toHaveLength(1);
    const parts = splitSelectors(none[0].selector);
    expect(parts).toHaveLength(2);
    const exclusion = (s: string) => /:not\(([^)]*)\)\s*$/.exec(s)?.[1];
    expect(exclusion(parts[0])).toBe(
      '[data-column="main"], [data-column="key"]',
    );
    expect(exclusion(parts[1])).toBe(exclusion(parts[0]));
    expect(
      parts.some((p) =>
        p.endsWith(
          '.spartan-table-cell:not([data-column="main"], [data-column="key"])',
        ),
      ),
    ).toBe(true);
    expect(
      parts.some((p) =>
        p.endsWith(
          '.spartan-table-head:not([data-column="main"], [data-column="key"])',
        ),
      ),
    ).toBe(true);
  });

  it('applies every collapsing rule only to a table that names a main column', () => {
    const tableRules = phoneRules.filter((r) =>
      /spartan-table/.test(r.selector),
    );

    expect(tableRules.length).toBeGreaterThan(0);
    for (const { selector } of tableRules) {
      for (const part of splitSelectors(selector)) {
        expect(part.trim()).toMatch(
          /^\.spartan-table:has\(\[data-column="main"\]\)/,
        );
      }
    }
  });

  it('leaves the table, rows and header untouched from 768 px up', () => {
    expect(outsidePhone).not.toContain('data-column');
    const above = rulesOf(outsidePhone).filter((r) =>
      /spartan-table-(header|body)\b/.test(r.selector),
    );
    for (const { body } of above) {
      expect(body).not.toMatch(
        /display:\s*(none|block|flex)|position:\s*absolute|clip-path/,
      );
    }
    for (const { selector, body } of rulesOf(outsidePhone)) {
      if (/^\.spartan-table(-row|-head|-cell)?$/.test(selector)) {
        expect(body).not.toMatch(/display:\s*(none|block|flex)/);
      }
    }
  });

  it('adds no width or overflow that could scroll sideways at 320 px', () => {
    for (const { selector, body } of phoneRules) {
      expect({
        hit: /overflow(-x)?:\s*(scroll|auto)/.test(body),
        selector,
      }).toEqual({
        hit: false,
        selector,
      });
      for (const [, , value] of body.matchAll(
        /(?:^|;)\s*(min-width|width)\s*:\s*([\d.]+)px/g,
      )) {
        expect({ selector, value: Number(value) }).toEqual({
          selector,
          value: Math.min(Number(value), 320),
        });
      }
    }
  });

  it('puts the visually hidden header out of the layout flow', () => {
    const header = targets('.spartan-table-header');

    expect(header).toHaveLength(1);
    expect(header[0].body).toMatch(/position:\s*absolute/);
    expect(header[0].body).not.toMatch(
      /\b(left|top|right|bottom|inset)\s*:\s*-/,
    );
    expect(header[0].body).not.toMatch(
      /(^|;)\s*(margin|padding)[^;]*:\s*[1-9]/,
    );
  });

  it('keeps main first and key last on the same line', () => {
    const row = targets('.spartan-table-row')[0];
    const main = targets('[data-column="main"]').find((r) =>
      /order:/.test(r.body),
    );
    const key = targets('[data-column="key"]').find((r) =>
      /order:/.test(r.body),
    );

    expect(row.body).toMatch(/display:\s*flex/);
    expect(row.body).not.toMatch(/flex-wrap:\s*wrap|flex-direction:\s*column/);
    expect(main?.body).toMatch(/order:\s*0/);
    expect(main?.body).toMatch(/min-width:\s*0/);
    expect(key?.body).toMatch(/order:\s*1/);
  });
});
