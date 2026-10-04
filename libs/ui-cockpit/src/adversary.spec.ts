import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Panel, provideCockpitTheme } from './index';

const css = readFileSync(join(__dirname, 'styles/cockpit.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

interface Block {
  header: string;
  body: string;
}

function blocks(source: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let headerStart = 0;
  [...source].forEach((char, i) => {
    if (char === '{' && depth++ === 0) {
      start = i + 1;
      found.push({ body: '', header: source.slice(headerStart, i).trim() });
    }
    if (char === '}' && --depth === 0) {
      found[found.length - 1].body = source.slice(start, i);
      headerStart = i + 1;
    }
  });
  return found;
}

function tokens(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/(--mf-[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

const top = blocks(css);
const root = tokens(top.find((b) => b.header.endsWith(':root'))?.body ?? '');
const media = (query: RegExp) =>
  top
    .filter((b) => query.test(b.header))
    .flatMap((b) => blocks(b.body))
    .filter((b) => b.header.includes(':root'))
    .map((b) => tokens(b.body));
const light = new Map(
  media(/prefers-color-scheme:\s*light/).flatMap((m) => [...m]),
);
const print = new Map(media(/^@media\b.*\bprint\b/).flatMap((m) => [...m]));

const colourValue = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix\(/i;
const colourTokens = [...root].filter(([, v]) => colourValue.test(v));

describe('cockpit stylesheet tokens', () => {
  it('declares a light override for every dark colour token', () => {
    const missing = colourTokens.map(([k]) => k).filter((k) => !light.has(k));

    expect(colourTokens.length).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });

  it('declares a print override for every dark colour token', () => {
    const missing = colourTokens.map(([k]) => k).filter((k) => !print.has(k));

    expect(missing).toEqual([]);
  });

  it('does not repeat a dark value in the light set apart from the shared amber fill', () => {
    const shared = new Set(['--mf-amber', '--mf-amber-hover']);
    const leaked = [...light].filter(
      ([k, v]) => !shared.has(k) && root.get(k) === v && colourValue.test(v),
    );

    expect(leaked).toEqual([]);
  });

  it('keeps the dark background, panel and text values out of the light set', () => {
    const lightValues = [...light.values()].join(' ').toLowerCase();

    expect(lightValues).not.toContain('#0b0c0e');
    expect(lightValues).not.toContain('#f2f2f0');
    expect(lightValues).not.toContain('#101215');
  });

  it('uses the darker amber ink and focus colour in the light set', () => {
    expect(light.get('--mf-amber-ink')?.toLowerCase()).toBe('#8a5e00');
    expect(light.get('--mf-focus')?.toLowerCase()).toBe('#8a5e00');
  });
});

describe('provideCockpitTheme under misuse', () => {
  it('gives the same overlay defaults when registered twice', () => {
    TestBed.configureTestingModule({
      providers: [provideCockpitTheme(), provideCockpitTheme()],
    });

    expect(TestBed.inject(OVERLAY_DEFAULT_CONFIG)).toEqual({
      usePopover: false,
    });
  });
});

describe('helm component rules', () => {
  const declared = new Set(
    [...css.matchAll(/(--mf-[\w-]+)\s*:/g)].map((m) => m[1]),
  );
  const outsideTokens = top.filter(
    (b) =>
      !b.header.endsWith(':root') &&
      !/prefers-color-scheme|print/.test(b.header),
  );

  it('contains no named colour keyword as a colour value', () => {
    const named =
      /(?:color|background|border[\w-]*|outline|fill)\s*:\s*(white|black|red|green|blue|gray|grey|orange|yellow)\b/i;
    const offenders = outsideTokens.filter((b) => named.test(b.body));

    expect(offenders.map((b) => b.header)).toEqual([]);
  });

  it('only references custom properties that the stylesheet defines', () => {
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((n) => !declared.has(n))).toEqual([]);
  });
});

describe('Panel title edge cases', () => {
  @Component({
    imports: [Panel],
    template: `
      <mf-panel heading="">x</mf-panel>
      <mf-panel [heading]="longTitle">y</mf-panel>
      <mf-panel heading="<b>ș</b>">z</mf-panel>
      <mf-panel heading="Unu">a</mf-panel>
      <mf-panel heading="Doi">b</mf-panel>
    `,
  })
  class Host {
    longTitle = 'Ț'.repeat(5000);
  }

  function sections() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('section'),
    ];
  }

  it('renders no heading for an empty-string title', () => {
    const [empty] = sections();

    expect(empty.querySelector('h2')).toBeNull();
    expect(empty.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('renders a very long title in full', () => {
    const [, long] = sections();

    expect(long.querySelector('h2')?.textContent?.trim()).toBe(
      'Ț'.repeat(5000),
    );
  });

  it('shows markup in a title as literal text', () => {
    const [, , hostile] = sections();

    expect(hostile.querySelector('b')).toBeNull();
    expect(hostile.querySelector('h2')?.textContent?.trim()).toBe('<b>ș</b>');
  });

  it('gives two titled panels distinct heading ids', () => {
    const all = sections();
    const unu = all[3].querySelector('h2')?.id;
    const doi = all[4].querySelector('h2')?.id;

    expect(unu).toBeTruthy();
    expect(unu).not.toBe(doi);
  });
});
