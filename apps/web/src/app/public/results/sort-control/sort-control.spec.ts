import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { SortControl } from './sort-control';

type Sort = 'rating' | 'distance' | 'price';

@Component({
  imports: [SortControl],
  template: `<mf-sort-control
    [sort]="sort()"
    [placeKnown]="placeKnown()"
    (pick)="picked.push($event)"
  />`,
})
class Host {
  readonly sort = signal<Sort>('rating');
  readonly placeKnown = signal(true);
  readonly picked: Sort[] = [];
}

async function render() {
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 328-FR-009 328-FR-011
describe('SortControl', () => {
  let fixture: Awaited<ReturnType<typeof render>>;
  const host = () => fixture.nativeElement as HTMLElement;
  const buttons = () => [
    ...host().querySelectorAll<HTMLButtonElement>('button'),
  ];
  const button = (name: string) => buttons().find((b) => said(b) === name);

  beforeEach(async () => {
    fixture = await render();
  });

  it('is a group named Sortare of three buttons, the current one pressed', () => {
    expect(host().querySelector('fieldset')?.getAttribute('aria-label')).toBe(
      'Sortare',
    );
    expect(buttons().map(said)).toEqual(['Notă', 'Distanță', 'Preț']);
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(buttons().every((b) => b.type === 'button')).toBe(true);
  });

  it('marks the sort it is given', () => {
    fixture.componentInstance.sort.set('price');
    fixture.detectChanges();

    expect(button('Preț')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Notă')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('says which sort was picked', () => {
    button('Distanță')?.click();
    button('Preț')?.click();

    expect(fixture.componentInstance.picked).toEqual(['distance', 'price']);
  });

  it('turns Distanță off without a place, saying why, and keeps the others', () => {
    fixture.componentInstance.placeKnown.set(false);
    fixture.detectChanges();

    const distance = button('Distanță');
    expect(distance?.disabled).toBe(true);
    const why = host().querySelector(
      `#${distance?.getAttribute('aria-describedby')}`,
    );
    expect(said(why)).toBe('Alege un loc');
    expect(button('Notă')?.disabled).toBe(false);
    expect(button('Preț')?.disabled).toBe(false);

    distance?.click();
    expect(fixture.componentInstance.picked).toEqual([]);
  });

  it('slides one hidden thumb under the pressed sort, inside the group', () => {
    const thumbs = () => host().querySelectorAll('fieldset .thumb');
    expect(thumbs()).toHaveLength(1);
    const thumb = thumbs()[0];
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    expect(thumb.getAttribute('data-at')).toBe('rating');

    fixture.componentInstance.sort.set('price');
    fixture.detectChanges();
    expect(thumbs()[0]).toBe(thumb);
    expect(thumb.getAttribute('data-at')).toBe('price');

    fixture.componentInstance.sort.set('distance');
    fixture.detectChanges();
    expect(thumb.getAttribute('data-at')).toBe('distance');
  });

  it('describes nothing while a place is known', () => {
    expect(button('Distanță')?.hasAttribute('aria-describedby')).toBe(false);
  });
});

// The pressed sort's own background carries the tint, opaque, so its amber
// text measures against what is drawn under it; the sliding thumb behind it
// is only the motion. Measured in both schemes from the theme's tokens.
describe('SortControl pressed contrast', () => {
  const css = readFileSync(join(__dirname, 'sort-control.css'), 'utf8');
  const theme = readFileSync(
    join(
      __dirname,
      '../../../../../../../libs/ui-cockpit/src/styles/cockpit.css',
    ),
    'utf8',
  );
  const light = theme.slice(
    theme.indexOf('@media (prefers-color-scheme: light)'),
  );
  const token = (block: string, name: string) => {
    const hex = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(block)?.[1];
    if (!hex) throw new Error(`no ${name}`);
    return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  };
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const pressed =
    /\.sort\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('paints the pressed sort its own opaque tint, not the thumb behind it', () => {
    expect(pressed.replace(/\s+/g, ' ')).toMatch(
      /background-color: color-mix\( ?in srgb, var\(--mf-amber-ink\) 10%, var\(--mf-panel\) ?\);/,
    );
    expect(pressed).toMatch(/color:\s*var\(--mf-amber-ink\);/);
  });

  for (const [scheme, block] of [
    ['dark', theme],
    ['light', light],
  ] as const) {
    it(`keeps the pressed text at 4.5:1 or more in ${scheme}`, () => {
      const ink = token(block, 'mf-amber-ink');
      const panel = token(block, 'mf-panel');
      const tint = ink.map((c, i) => Math.round(c * 0.1 + panel[i] * 0.9));
      expect(ratio(ink, tint)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
