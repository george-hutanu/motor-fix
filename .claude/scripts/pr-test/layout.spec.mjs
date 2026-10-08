import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { measureLayout } from './layout.mjs';

// Every rule runs in a real browser against a fixture page it must fault and
// one it must pass. Off CI a machine without the browser skips; in CI the
// Checks job installs it, so a missing browser fails there.
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const fixture = (name) => pathToFileURL(fileURLToPath(new URL(`./fixtures/layout/${name}.html`, import.meta.url))).href;

let browser = null;
try {
  browser = await chromium.launch();
} catch (error) {
  if (process.env.CI) throw error;
}

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 568 };
const DESKTOP = { width: 1440, height: 900 };
const AS = {
  phone: { viewport: PHONE, opts: { phone: true, tapTargets: true, focus: false } },
  'small-phone': { viewport: SMALL_PHONE, opts: { phone: true, tapTargets: true, focus: false } },
  desktop: { viewport: DESKTOP, opts: { phone: false, tapTargets: false, focus: true } },
};

async function measure(page, { at = 'phone', html } = {}) {
  const { viewport, opts } = AS[at];
  const context = await browser.newContext({ viewport });
  try {
    const tab = await context.newPage();
    if (html) await tab.setContent(html);
    else await tab.goto(fixture(page));
    return await tab.evaluate(measureLayout, opts);
  } finally {
    await context.close();
  }
}

const of = (result, rule) => result.observations.filter((o) => o.rule === rule);
const selectors = (result, rule) => of(result, rule).map((o) => o.selector).sort();

describe.skipIf(!browser)('layout checks in a browser', () => {
  afterAll(() => browser?.close());

  describe('min-text', () => {
    it('faults 13 px body text on a phone, 11 px text anywhere and a 14 px field', async () => {
      const r = await measure('min-text-fail');
      expect(selectors(r, 'min-text')).toEqual(['input#field14', 'p#body13', 'span#tiny']);
      const body = of(r, 'min-text').find((o) => o.selector === 'p#body13');
      expect(body).toMatchObject({ kind: 'layout', measured: '13px', expected: '16px (phone body)' });
      expect(body.text).toContain('Programează');
      expect(of(r, 'min-text').find((o) => o.selector === 'span#tiny').expected).toBe('12px');
      expect(of(r, 'min-text').find((o) => o.selector === 'input#field14').expected).toBe('16px (field)');
    });

    it('holds a label and a definition term to 16 px on a phone', async () => {
      const html = `<dl><dt id="term" style="font-size:13px">Programare</dt><dd style="font-size:16px">Luni</dd></dl><label id="name" style="font-size:13px">Nume</label>`;
      expect(selectors(await measure(null, { html }), 'min-text')).toEqual(['dt#term', 'label#name']);
    });

    it('holds a desktop to the 12 px floor and the field size only', async () => {
      const r = await measure('min-text-fail', { at: 'desktop' });
      expect(selectors(r, 'min-text')).toEqual(['input#field14', 'span#tiny']);
    });

    it('passes 16 px body with a 13 px caption inside it and 12 px secondary text', async () => {
      expect(of(await measure('min-text-pass'), 'min-text')).toEqual([]);
    });

    it('lists at most 20 elements per rule, then counts the rest', async () => {
      const spans = Array.from({ length: 25 }, (_, i) => `<span id="s${i}" style="font-size:10px">t${i}</span>`).join(' ');
      const r = await measure(null, { html: `<body>${spans}</body>` });
      const found = of(r, 'min-text');
      expect(found).toHaveLength(21);
      expect(found[20].text).toBe('…and 5 more');
    });

    it('skips hidden and screen-reader-only text', async () => {
      const html = `<body><span style="display:none;font-size:9px">a</span><span style="visibility:hidden;font-size:9px">b</span>
        <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);font-size:9px">only for readers</span></body>`;
      expect((await measure(null, { html })).observations).toEqual([]);
    });
  });

  describe('type-scale', () => {
    it('faults a size the theme tokens do not name, listing the scale it read', async () => {
      const r = await measure('type-scale-fail');
      expect(selectors(r, 'type-scale')).toEqual(['p#off']);
      expect(of(r, 'type-scale')[0]).toMatchObject({ measured: '14px', expected: 'one of 12px, 13px, 16px' });
      expect(r.tokens.sizes.map((s) => s.name)).toEqual(['--mf-size-body', '--mf-size-field', '--mf-size-label', '--mf-size-small']);
    });

    it('passes text set with the tokens', async () => {
      expect(of(await measure('type-scale-pass'), 'type-scale')).toEqual([]);
    });

    it('checks nothing on a page that declares no size token', async () => {
      const r = await measure('min-text-fail');
      expect(of(r, 'type-scale')).toEqual([]);
      expect(r.tokens.sizes).toEqual([]);
    });
  });

  describe('tap-target', () => {
    it('faults a 32 px icon button on a phone', async () => {
      const r = await measure('tap-target-fail');
      expect(selectors(r, 'tap-target')).toEqual(['button#icon']);
      expect(of(r, 'tap-target')[0]).toMatchObject({ measured: '32×32px', expected: '44×44px' });
    });

    it('passes a 44 px button and a link inside running text', async () => {
      expect(of(await measure('tap-target-pass'), 'tap-target')).toEqual([]);
    });

    it('does not measure tap targets at a desktop without touch', async () => {
      expect(of(await measure('tap-target-fail', { at: 'desktop' }), 'tap-target')).toEqual([]);
    });
  });

  describe('clipped', () => {
    it('faults a cut label, a label spilling out of its button, an ellipsis and a line clamp at 320 px', async () => {
      const r = await measure('clipped-fail', { at: 'small-phone' });
      expect(selectors(r, 'clipped')).toEqual(['button#cut', 'button#spill', 'div#clamp', 'div#ellipsis']);
      expect(of(r, 'clipped').find((o) => o.selector === 'button#cut').expected).toBe('fits its box');
    });

    it('faults a line cut by a box shorter than its line by more than 0.5 px (FR-004)', async () => {
      const html = `<p id="short" style="margin:0;overflow:hidden;height:20px;font:16px/24px sans-serif">Programează revizia</p>
        <p id="tight" style="margin:0;overflow:hidden;font:16px/1 sans-serif">Programează revizia</p>`;
      expect(selectors(await measure(null, { html }), 'clipped')).toEqual(['p#short']);
    });

    it('passes a scroller, a label that fits and a short title', async () => {
      expect(of(await measure('clipped-pass', { at: 'small-phone' }), 'clipped')).toEqual([]);
    });
  });

  describe('overlap', () => {
    it('faults two buttons drawn over each other, naming both', async () => {
      const r = await measure('overlap-fail', { at: 'desktop' });
      expect(selectors(r, 'overlap')).toEqual(['button#first × button#second']);
    });

    it('faults a page control painted over a control in a pinned bar, and passes one the bar covers', async () => {
      const bar = (z) => `<div style="position:sticky;bottom:0;z-index:${z};background:#fff;padding:8px"><button id="save" style="width:200px;height:48px">Save</button></div>`;
      const over = `<div style="height:760px"></div><div style="position:relative;height:0"><a id="credit" href="#" style="position:absolute;z-index:2;top:0;left:0;display:block;width:300px;height:44px;background:#eee">Credit</a></div>${bar(1)}`;
      expect(selectors(await measure(null, { html: over }), 'overlap')).toEqual(['a#credit × button#save']);
      const under = over.replace('z-index:2;', 'z-index:0;').replace('z-index:1;', 'z-index:5;');
      expect(of(await measure(null, { html: under }), 'overlap')).toEqual([]);
    });

    it('passes a button inside a link card and two buttons side by side', async () => {
      expect(of(await measure('overlap-pass', { at: 'desktop' }), 'overlap')).toEqual([]);
    });
  });

  describe('grid', () => {
    it('faults a 13 px gap and padding off the 4 px grid', async () => {
      const r = await measure('grid-fail');
      expect(selectors(r, 'grid')).toEqual(['div#pad', 'div#row']);
      expect(of(r, 'grid').find((o) => o.selector === 'div#row')).toMatchObject({ measured: 'gap 13px', expected: 'a multiple of 4px' });
      expect(of(r, 'grid').find((o) => o.selector === 'div#pad').measured).toBe('padding 6px 10px 5px 10px');
    });

    it('passes on-grid gaps and padding, half a pixel of rounding, and ignores margins', async () => {
      expect(of(await measure('grid-pass'), 'grid')).toEqual([]);
    });
  });

  describe('stretched-image', () => {
    it('faults an image drawn at a ratio other than its own', async () => {
      const r = await measure('stretched-image-fail');
      expect(selectors(r, 'stretched-image')).toEqual(['img#squashed']);
      expect(of(r, 'stretched-image')[0]).toMatchObject({ measured: 'rendered 200×75', expected: 'natural ratio 40×30' });
    });

    it('passes object-fit cover and a ratio within 2 %', async () => {
      expect(of(await measure('stretched-image-pass'), 'stretched-image')).toEqual([]);
    });
  });

  describe('font-fallback', () => {
    it('faults a theme font that failed to load, naming the fallback in use', async () => {
      const r = await measure('font-fallback-fail');
      expect(selectors(r, 'font-fallback')).toEqual(['--mf-font-body', '@font-face "Orphan Serif"']);
      expect(of(r, 'font-fallback')[0]).toMatchObject({ selector: '--mf-font-body', measured: '"Missing Grotesk" (error)', expected: '"Missing Grotesk" loaded (in use: system-ui)' });
    });

    it('faults a face the page declared and used that failed, though no theme token names it', async () => {
      const r = await measure('font-fallback-fail');
      expect(of(r, 'font-fallback').find((o) => o.selector === '@font-face "Orphan Serif"')).toMatchObject({ measured: '"Orphan Serif" (error)', expected: '"Orphan Serif" loaded' });
    });

    it('passes a theme font the system provides', async () => {
      expect(of(await measure('font-fallback-pass'), 'font-fallback')).toEqual([]);
    });
  });

  describe('focus-ring', () => {
    it('faults a button that shows nothing when focused from the keyboard', async () => {
      const r = await measure('focus-ring-fail', { at: 'desktop' });
      expect(selectors(r, 'focus-ring')).toEqual(['button#bare']);
      expect(of(r, 'focus-ring')[0]).toMatchObject({ measured: 'no change on focus', expected: 'a visible focus ring' });
    });

    it('passes an outline on focus-visible and the browser default ring', async () => {
      expect(of(await measure('focus-ring-pass', { at: 'desktop' }), 'focus-ring')).toEqual([]);
    });

    it('leaves focus rings unmeasured off the desktop pass', async () => {
      expect(of(await measure('focus-ring-fail'), 'focus-ring')).toEqual([]);
    });
  });
});

describe('without a browser', () => {
  it('is one self-contained function, so page.evaluate can send it', () => {
    expect(typeof measureLayout).toBe('function');
    expect(measureLayout.toString()).not.toMatch(/\bimport\(|\brequire\(/);
  });
});
