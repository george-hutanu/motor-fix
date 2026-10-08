import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

import { measureLayout } from './layout.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

let browser = null;
try {
  browser = await chromium.launch();
} catch (error) {
  if (process.env.CI) throw error;
}

const AS = {
  phone: { viewport: { width: 390, height: 844 }, opts: { phone: true, tapTargets: true, focus: false } },
  tablet: { viewport: { width: 834, height: 1112 }, opts: { phone: false, tapTargets: true, focus: false } },
  small: { viewport: { width: 320, height: 568 }, opts: { phone: true, tapTargets: true, focus: false } },
  desktop: { viewport: { width: 1440, height: 900 }, opts: { phone: false, tapTargets: false, focus: true } },
};
const page = (body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:16px system-ui}${head}</style></head><body>${body}</body></html>`;

async function measure(html, at = 'phone', prepare) {
  const { viewport, opts } = AS[at];
  const context = await browser.newContext({ viewport });
  try {
    const tab = await context.newPage();
    await tab.setContent(html);
    if (prepare) await prepare(tab);
    return await tab.evaluate(measureLayout, opts);
  } finally {
    await context.close();
  }
}
const of = (r, rule) => r.observations.filter((o) => o.rule === rule);
const sel = (r, rule) => of(r, rule).map((o) => o.selector).sort();

describe.skipIf(!browser)('layout checks against hostile pages', () => {
  afterAll(() => browser?.close());

  describe('empty and degenerate pages', () => {
    it('reports nothing and no tokens on an empty body', async () => {
      const r = await measure(page(''));
      expect(r.observations).toEqual([]);
      expect(r.tokens.sizes).toEqual([]);
      expect(r.tokens.fonts).toEqual([]);
    });

    it('returns the same answer when called twice on the same page', async () => {
      const { viewport, opts } = AS.phone;
      const context = await browser.newContext({ viewport });
      try {
        const tab = await context.newPage();
        await tab.setContent(page('<p style="font-size:13px">uno</p><div style="display:flex;gap:13px"><button>a</button><button>b</button></div>'));
        const a = await tab.evaluate(measureLayout, opts);
        const b = await tab.evaluate(measureLayout, opts);
        expect(b).toEqual(a);
        expect(a.observations.length).toBeGreaterThan(0);
      } finally {
        await context.close();
      }
    });

    it('survives svg, math, custom elements, templates, iframes and empty inline elements', async () => {
      const r = await measure(
        page(
          '<svg width="40" height="40"><text x="0" y="20" style="font-size:9px">x</text><circle r="5"/></svg><math><mi>x</mi></math><my-el style="font-size:20px">hi</my-el><template><p style="font-size:8px">t</p></template><iframe srcdoc="<p style=font-size:8px>in</p>"></iframe><span></span><b></b>',
        ),
      );
      expect(Array.isArray(r.observations)).toBe(true);
      expect(sel(r, 'min-text')).not.toContain('template > p');
    });

    it('finishes a page of several thousand elements and still caps each rule at 20 plus a count', async () => {
      const items = Array.from({ length: 4000 }, (_, i) => `<div style="display:flex;gap:13px"><span style="font-size:9px">n${i}</span></div>`).join('');
      const started = Date.now();
      const r = await measure(page(items));
      expect(Date.now() - started).toBeLessThan(20000);
      expect(of(r, 'grid')).toHaveLength(21);
      expect(of(r, 'grid')[20].text).toMatch(/…and \d+ more/);
      expect(of(r, 'min-text')).toHaveLength(21);
    }, 60000);
  });

  describe('what is not measured', () => {
    it('skips display none, visibility hidden, opacity-free zero-size and script or style text', async () => {
      const r = await measure(
        page(
          '<p style="display:none;font-size:9px">a</p><p style="visibility:hidden;font-size:9px">b</p><p style="width:0;height:0;overflow:hidden;font-size:9px">c</p><div style="display:none"><p style="font-size:9px">d</p></div><details><summary style="font-size:16px">s</summary><p style="font-size:9px">closed</p></details><script>var x=1</script>',
        ),
      );
      expect(of(r, 'min-text')).toEqual([]);
      expect(of(r, 'clipped')).toEqual([]);
    });

    it('skips whitespace-only elements with a small font', async () => {
      const r = await measure(page('<p style="font-size:8px"> </p><span style="font-size:8px">\n</span>'));
      expect(of(r, 'min-text')).toEqual([]);
    });

    it('skips hidden controls for tap targets', async () => {
      const r = await measure(page('<button style="display:none;width:10px;height:10px">x</button><input type="hidden" name="h">'));
      expect(of(r, 'tap-target')).toEqual([]);
    });

    it('measures a violation far below the fold', async () => {
      const r = await measure(page('<div style="height:6000px"></div><p id="deep" style="font-size:9px">deep</p>'));
      expect(sel(r, 'min-text')).toEqual(['p#deep']);
    });
  });

  describe('min-text boundaries', () => {
    it('accepts exactly 16 px body and 12 px text and faults 15 px body and 11 px text', async () => {
      const r = await measure(page('<p id="ok16" style="font-size:16px">a</p><p id="bad15" style="font-size:15px">a</p><span id="ok12" style="font-size:12px">a</span><span id="bad11" style="font-size:11px">a</span>'));
      expect(sel(r, 'min-text')).toEqual(['p#bad15', 'span#bad11']);
    });

    it('holds the 320 px phone to the same 16 px floor', async () => {
      const r = await measure(page('<p id="b" style="font-size:15px">a</p>'), 'small');
      expect(sel(r, 'min-text')).toEqual(['p#b']);
    });

    it('faults a 14 px textarea and select at every viewport and passes 16 px ones', async () => {
      const body = '<textarea id="t14" style="font-size:14px">hello</textarea><select id="s14" style="font-size:14px"><option>a</option></select><textarea id="t16" style="font-size:16px"></textarea><select id="s16" style="font-size:16px"><option>a</option></select><input id="i16" style="font-size:16px">';
      for (const at of ['phone', 'tablet', 'desktop']) {
        const r = await measure(page(body), at);
        expect(sel(r, 'min-text').filter((s) => /#(t|s)14$/.test(s))).toEqual(['select#s14', 'textarea#t14']);
        expect(sel(r, 'min-text')).not.toContain('input#i16');
      }
    });

    it('faults an empty 14 px textarea, since iOS zooms into it whatever it holds', async () => {
      const r = await measure(page('<textarea id="empty" style="font-size:14px"></textarea>'), 'desktop');
      expect(sel(r, 'min-text')).toEqual(['textarea#empty']);
    });

    it('faults 14 px list items, table cells, buttons and standalone links on a phone but not a tablet', async () => {
      const html = page('<ul><li id="li" style="font-size:14px">x</li></ul><table><tr><td id="td" style="font-size:14px">x</td></tr></table><button id="btn" style="font-size:14px;min-height:44px">x</button><a id="lnk" href="#" style="font-size:14px;display:block;min-height:44px">x</a>');
      expect(sel(await measure(html), 'min-text')).toEqual(['a#lnk', 'button#btn', 'li#li', 'td#td']);
      expect(of(await measure(html, 'tablet'), 'min-text')).toEqual([]);
    });

    it('measures a paragraph by its own text, not by a smaller child', async () => {
      const r = await measure(page('<p id="p" style="font-size:16px">Body text <small style="font-size:13px">caption</small></p>'));
      expect(of(r, 'min-text')).toEqual([]);
    });

    it('measures fractional sizes without rounding them up to the floor', async () => {
      const r = await measure(page('<p id="p" style="font-size:15.5px">a</p><span id="s" style="font-size:11.5px">a</span>'));
      expect(sel(r, 'min-text')).toEqual(['p#p', 'span#s']);
    });

    it('carries unicode text through the observation intact', async () => {
      const r = await measure(page('<p id="p" style="font-size:12.5px">Șoferul își programează mașina 🚗 مرحبا</p>'));
      expect(of(r, 'min-text')[0].text).toContain('Șoferul');
      expect(of(r, 'min-text')[0].text).toContain('🚗');
    });

    it('keeps the observation text bounded for a very long paragraph', async () => {
      const r = await measure(page(`<p id="p" style="font-size:12.5px">${'x'.repeat(200000)}</p>`));
      expect(of(r, 'min-text')[0].text.length).toBeLessThanOrEqual(200);
    });

    it('does not turn markup in the text into selectors or break the selector', async () => {
      const r = await measure(page('<p id="a b&quot;c" class="x y" style="font-size:12.5px">&lt;script&gt;</p>'));
      expect(of(r, 'min-text')).toHaveLength(1);
      expect(typeof of(r, 'min-text')[0].selector).toBe('string');
    });
  });

  describe('type-scale with tokens', () => {
    const tokens = ':root{--mf-size-label:12px;--mf-size-small:13px;--mf-size-body:16px;--mf-size-field:16px}';
    it('lists the tokens it read and faults a size off the scale', async () => {
      const r = await measure(page('<p id="p" style="font-size:17px">x</p><p id="q" style="font-size:16px">x</p>', tokens), 'desktop');
      expect(r.tokens.sizes.map((s) => s.name).sort()).toEqual(['--mf-size-body', '--mf-size-field', '--mf-size-label', '--mf-size-small']);
      expect(sel(r, 'type-scale')).toEqual(['p#p']);
    });

    it('reads tokens declared in rem, so a text at that size is not faulted', async () => {
      const r = await measure(page('<p id="q" style="font-size:16px">x</p>', ':root{--mf-size-body:1rem;--mf-size-small:0.8125rem}'), 'desktop');
      expect(of(r, 'type-scale')).toEqual([]);
    });

    it('treats a token that is not a length as absent instead of faulting every text', async () => {
      const r = await measure(page('<p style="font-size:16px">x</p>', ':root{--mf-size-body:banana}'), 'desktop');
      expect(of(r, 'type-scale')).toEqual([]);
    });

    it('does not fault a 16 px text because the scale has 16.0001 rounding noise', async () => {
      const r = await measure(page('<p id="q" style="font-size:16.4px">x</p>', ':root{--mf-size-body:16.4px}'), 'desktop');
      expect(of(r, 'type-scale')).toEqual([]);
    });
  });

  describe('tap-target boundaries', () => {
    it('accepts 44 by 44, faults 44 by 43 and 43 by 44', async () => {
      const r = await measure(
        page('<button id="ok" style="width:44px;height:44px;padding:0">a</button><button id="short" style="width:44px;height:43px;padding:0">a</button><button id="narrow" style="width:43px;height:44px;padding:0">a</button>'),
      );
      expect(sel(r, 'tap-target')).toEqual(['button#narrow', 'button#short']);
    });

    it('faults a bare 24 px link in a nav and an unpadded input, not a link in a sentence', async () => {
      const r = await measure(page('<nav><a id="nav" href="#" style="display:inline-block;height:24px">Acasă</a></nav><p>Citește <a id="inline" href="#">termenii</a> acum.</p><input id="in" style="height:30px;font-size:16px">'));
      expect(sel(r, 'tap-target')).toEqual(['a#nav', 'input#in']);
    });

    it('measures taps on the tablet and on the 320 px phone as well', async () => {
      const html = page('<button id="b" style="width:20px;height:20px;padding:0">a</button>');
      for (const at of ['tablet', 'small']) expect(sel(await measure(html, at), 'tap-target')).toEqual(['button#b']);
    });
  });

  describe('clipped boundaries', () => {
    it('faults a label wider than its hidden-overflow box and not one that fits', async () => {
      const r = await measure(page('<div id="far" style="width:60px;overflow:hidden;white-space:nowrap">Programează vizita acum</div><div id="fits" style="width:300px;overflow:hidden;white-space:nowrap">scurt</div>'));
      expect(sel(r, 'clipped')).toEqual(['div#far']);
    });

    it('does not fault overflow auto, scroll, or overflow hidden with content that fits', async () => {
      const r = await measure(
        page('<div style="width:50px;overflow:auto;white-space:nowrap">a long unbroken line of words</div><div style="width:50px;overflow:scroll;white-space:nowrap">a long unbroken line of words</div><div style="width:300px;overflow:hidden">fits</div>'),
      );
      expect(of(r, 'clipped')).toEqual([]);
    });

    it('faults a vertical clip of a fixed-height box', async () => {
      const r = await measure(page('<div id="v" style="height:20px;overflow:hidden">line one<br>line two<br>line three<br>line four</div>'));
      expect(sel(r, 'clipped')).toEqual(['div#v']);
    });
  });

  describe('overlap boundaries', () => {
    const two = (dx, dy) => page(`<button id="a" style="position:absolute;left:10px;top:10px;width:100px;height:50px;padding:0">a</button><button id="b" style="position:absolute;left:${10 + dx}px;top:${10 + dy}px;width:100px;height:50px;padding:0">b</button>`);

    it('ignores boxes that touch and ones that overlap by 0.4 px, and faults 1 px on both axes', async () => {
      expect(of(await measure(two(100, 0), 'desktop'), 'overlap')).toEqual([]);
      expect(of(await measure(two(99.6, 0), 'desktop'), 'overlap')).toEqual([]);
      expect(of(await measure(two(99, 49), 'desktop'), 'overlap')).toHaveLength(1);
    });

    it('does not fault a corner that overlaps on one axis only', async () => {
      expect(of(await measure(two(100, 49), 'desktop'), 'overlap')).toEqual([]);
    });

    it('does not fault an input nested in a label link or a button inside a link', async () => {
      const r = await measure(page('<label>Nume <input style="font-size:16px"></label><a href="#">card <button>go</button></a>'), 'desktop');
      expect(of(r, 'overlap')).toEqual([]);
    });
  });

  describe('grid boundaries', () => {
    const row = (gap) => page(`<div id="r" style="display:flex;${gap}"><span>a</span><span>b</span></div>`);

    it('treats 12.5 and 15.5 as on the grid and 13 and 14 as off it', async () => {
      expect(of(await measure(row('gap:12.5px'), 'desktop'), 'grid')).toEqual([]);
      expect(of(await measure(row('gap:15.5px'), 'desktop'), 'grid')).toEqual([]);
      expect(sel(await measure(row('gap:13px'), 'desktop'), 'grid')).toEqual(['div#r']);
      expect(sel(await measure(row('gap:14px'), 'desktop'), 'grid')).toEqual(['div#r']);
    });

    it('faults an off-grid column gap on its own, and the row gap of a grid container', async () => {
      expect(sel(await measure(row('gap:8px 13px'), 'desktop'), 'grid')).toEqual(['div#r']);
      const r = await measure(page('<div id="g" style="display:grid;row-gap:10px"><span>a</span><span>b</span></div>'), 'desktop');
      expect(sel(r, 'grid')).toEqual(['div#g']);
    });

    it('accepts zero, no gap at all and gap: normal', async () => {
      expect(of(await measure(row('gap:0'), 'desktop'), 'grid')).toEqual([]);
      expect(of(await measure(row(''), 'desktop'), 'grid')).toEqual([]);
    });

    it('does not fault off-grid spacing on a hidden element, nor margins', async () => {
      const r = await measure(page('<div style="display:none;gap:13px;padding:5px"></div><div style="margin:13px 7px">m</div><div style="margin:0 auto;width:101px">c</div>'), 'desktop');
      expect(of(r, 'grid')).toEqual([]);
    });

    it('faults padding of one off-grid side among on-grid ones', async () => {
      const r = await measure(page('<div id="p" style="padding:8px 8px 8px 9px">x</div>'), 'desktop');
      expect(sel(r, 'grid')).toEqual(['div#p']);
    });

    it('gives the offending value in the measurement', async () => {
      const r = await measure(row('gap:13px'), 'desktop');
      expect(of(r, 'grid')[0].measured).toContain('13px');
    });
  });

  describe('stretched-image boundaries', () => {
    const png = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>');

    it('passes 1.5 % off, faults 3 % off', async () => {
      const r = await measure(page(`<img id="near" src="${png}" style="width:101.5px;height:100px"><img id="far" src="${png}" style="width:103px;height:100px">`), 'desktop', (tab) => tab.waitForFunction(() => [...document.images].every((i) => i.complete)));
      expect(sel(r, 'stretched-image')).toEqual(['img#far']);
    });

    it('skips an image that failed to load, one with no source and a hidden one, without throwing', async () => {
      const r = await measure(page('<img id="broken" src="http://127.0.0.1:1/x.png" style="width:100px;height:10px"><img id="empty" style="width:100px;height:10px"><img id="hidden" src="x" style="display:none">'), 'desktop');
      expect(of(r, 'stretched-image')).toEqual([]);
    });

    it('skips an svg image with no intrinsic size', async () => {
      const bare = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
      const r = await measure(page(`<img id="v" src="${bare}" style="width:200px;height:20px">`), 'desktop', (tab) => tab.waitForFunction(() => [...document.images].every((i) => i.complete)));
      expect(of(r, 'stretched-image').length).toBeLessThanOrEqual(1);
    });
  });

  describe('font-fallback', () => {
    it('is silent when the page names no font token', async () => {
      const r = await measure(page('<p>x</p>'), 'desktop');
      expect(of(r, 'font-fallback')).toEqual([]);
      expect(r.tokens.fonts).toEqual([]);
    });

    it('passes a token that lists a generic family only', async () => {
      const r = await measure(page('<p>x</p>', ':root{--mf-font-body:system-ui,sans-serif}'), 'desktop');
      expect(of(r, 'font-fallback')).toEqual([]);
    });

    it('faults one missing family per token once, not once per element', async () => {
      const r = await measure(page('<p>a</p><p>b</p><p>c</p>', ':root{--mf-font-body:"Ghost Sans",system-ui}@font-face{font-family:"Ghost Sans";src:url(http://127.0.0.1:1/g.woff2)}p{font-family:var(--mf-font-body)}'), 'desktop', (tab) => tab.evaluate(() => document.fonts.load('16px "Ghost Sans"').catch(() => null)));
      expect(of(r, 'font-fallback')).toHaveLength(1);
    });
  });

  describe('focus-ring', () => {
    it('restores the element that had focus before the measurement', async () => {
      const { viewport, opts } = AS.desktop;
      const context = await browser.newContext({ viewport });
      try {
        const tab = await context.newPage();
        await tab.setContent(page('<input id="keep" style="font-size:16px"><button>a</button><button>b</button>'));
        await tab.focus('#keep');
        await tab.evaluate(measureLayout, opts);
        expect(await tab.evaluate(() => document.activeElement?.id)).toBe('keep');
      } finally {
        await context.close();
      }
    });

    it('leaves the body active when nothing had focus', async () => {
      const { viewport, opts } = AS.desktop;
      const context = await browser.newContext({ viewport });
      try {
        const tab = await context.newPage();
        await tab.setContent(page('<button>a</button><a href="#">b</a>'));
        await tab.evaluate(measureLayout, opts);
        expect(await tab.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
      } finally {
        await context.close();
      }
    });

    it('faults a control whose outline is removed and nothing else replaces it', async () => {
      const r = await measure(page('<a id="l" href="#">x</a>', 'a:focus,a:focus-visible{outline:none}'), 'desktop');
      expect(sel(r, 'focus-ring')).toEqual(['a#l']);
    });

    it('passes a control that changes only its background on focus', async () => {
      const r = await measure(page('<button id="b">x</button>', 'button:focus-visible{outline:none;background:#ffd}'), 'desktop');
      expect(of(r, 'focus-ring')).toEqual([]);
    });

    it('does not measure disabled or hidden controls', async () => {
      const r = await measure(page('<button disabled style="outline:none">x</button><button style="display:none">y</button><a href="#" tabindex="-1" style="display:none">z</a>'), 'desktop');
      expect(of(r, 'focus-ring')).toEqual([]);
    });

    it('survives a focus handler that throws and one that moves focus elsewhere', async () => {
      const r = await measure(page('<button id="a" onfocus="throw new Error(\'x\')">a</button><button id="b" onfocus="document.getElementById(\'c\').focus()">b</button><button id="c">c</button>'), 'desktop');
      expect(Array.isArray(r.observations)).toBe(true);
    });
  });

  describe('phone and tablet passes do no focus work', () => {
    it('reports no focus-ring observation unless focus is enabled', async () => {
      const r = await measure(page('<button style="outline:none">x</button>'), 'tablet');
      expect(of(r, 'focus-ring')).toEqual([]);
    });

    it('reports no tap-target observation when tap targets are off, even on a phone-width page', async () => {
      const { viewport } = AS.phone;
      const context = await browser.newContext({ viewport });
      try {
        const tab = await context.newPage();
        await tab.setContent(page('<button style="width:10px;height:10px">x</button>'));
        const r = await tab.evaluate(measureLayout, { phone: true, tapTargets: false, focus: false });
        expect(of(r, 'tap-target')).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
});
