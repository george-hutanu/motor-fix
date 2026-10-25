// Adversarial cases for the sweep's chart shot: charts that ignore reduced motion, mount late, or get their data
// late, a page that never stops drawing, a whole scheme/language matrix, and how sensitive diffShots is to a bar
// that is a few pixels short of its final height.
import { afterAll, afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diffShots } from './baseline.mjs';
import { runSweep, VIEWPORTS } from './sweep.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const sharp = require('sharp');

const probeColour = async (shot, scale) => {
  const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (Math.round(3 * scale) * info.width + Math.round(60 * scale)) * info.channels;
  const [r, g, b] = data.subarray(at, at + 3);
  return r > 200 && g < 60 && b < 60 ? 'red' : `rgb(${r}, ${g}, ${b})`;
};

// A probe canvas whose single red bar reaches the canvas's top row only at the chart's final frame.
const page = ({ setup }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>t</title><script src="/chart.umd.js"></script>
<style>body{margin:0;background:#fff}#box{position:absolute;top:0;left:0;width:120px;height:120px}</style></head>
<body><div id="box"></div><main style="margin-top:200px"><h1>Chart</h1></main>
<script>
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mount = (animation, data = [100]) => {
  const c = document.createElement("canvas"); document.getElementById("box").appendChild(c);
  return new Chart(c, { type: "bar", data: { labels: ["x"], datasets: [{ data, backgroundColor: "#ff0000", barPercentage: 1, categoryPercentage: 1 }] },
    options: { animation, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } } } });
};
${setup}
</script></body></html>`;

describe('the sweep shoots an awkward chart page finished', async () => {
  let ready = true;
  try {
    const { chromium } = await import('@playwright/test');
    await (await chromium.launch()).close();
  } catch (error) {
    if (process.env.CI) throw error;
    ready = false;
  }
  const chartJs = require.resolve('chart.js').replace(/chart\.(c?js|mjs)$/, 'chart.umd.js');
  const pages = {};
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/chart.umd.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(chartJs));
      if (pages[path]) return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pages[path]);
    } catch {}
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const work = mkdtempSync(join(tmpdir(), 'sweep-chart-adv-'));
  afterAll(() => {
    server.close();
    rmSync(work, { recursive: true, force: true });
  });
  const sweep = (name, routes, extra = {}) => runSweep({ baseURL, routes, outDir: join(work, name, 'shots'), schemes: ['light'], langs: ['en'], repoRoot: root, ...extra });
  const probes = async (name, suffix = 'light-en') => {
    const dir = join(work, name, 'shots');
    const out = [];
    for (const [viewport, { deviceScaleFactor }] of Object.entries(VIEWPORTS)) {
      for (const shot of readdirSync(dir).filter((s) => s.endsWith(`-${viewport}-${suffix}.png`))) out.push([shot, await probeColour(join(dir, shot), deviceScaleFactor)]);
    }
    return out;
  };

  it.skipIf(!ready)('a chart that animates for 1.5 s even under reduced motion is shot at its final frame at every viewport, the same twice', async () => {
    pages['/ignores.html'] = page({ setup: 'mount({ duration: 1500, easing: "easeOutQuart" });' });
    await sweep('ignores', ['/ignores.html']);
    const found = await probes('ignores');
    assert.equal(found.length, Object.keys(VIEWPORTS).length);
    for (const [shot, colour] of found) assert.equal(colour, 'red', shot);
    // A second sweep of the same page finds no changed region.
    await sweep('ignores-b', ['/ignores.html']);
    const diff = await diffShots(join(work, 'ignores-b'), join(work, 'ignores'), join(work, 'ignores-diff'), { root });
    assert.equal(Object.keys(diff).length, Object.keys(VIEWPORTS).length);
    for (const [shot, outcome] of Object.entries(diff)) assert.equal(outcome.status, 'identical', shot);
  }, 240000);

  it.skipIf(!ready)('a chart mounted 800 ms after load is shot at its final frame', async () => {
    pages['/late-mount.html'] = page({ setup: 'setTimeout(() => mount(reduced ? false : { duration: 1000 }), 800);' });
    await sweep('late-mount', ['/late-mount.html']);
    const found = await probes('late-mount');
    assert.equal(found.length, Object.keys(VIEWPORTS).length);
    for (const [shot, colour] of found) assert.equal(colour, 'red', shot);
  }, 120000);

  it.skipIf(!ready)('a chart whose data arrives 800 ms after load and animates in is shot at its final frame', async () => {
    pages['/late-data.html'] = page({ setup: 'const c = mount({ duration: 1000 }, [0]); setTimeout(() => { c.data.datasets[0].data = [100]; c.update(); }, 800);' });
    await sweep('late-data', ['/late-data.html']);
    const found = await probes('late-data');
    assert.equal(found.length, Object.keys(VIEWPORTS).length);
    for (const [shot, colour] of found) assert.equal(colour, 'red', shot);
  }, 120000);

  it.skipIf(!ready)('a page that never stops drawing is still shot at every viewport within a bounded time', async () => {
    pages['/forever.html'] = page({ setup: 'const c = mount(false); let n = 0; const tick = () => { c.data.datasets[0].data = [90 + (n++ % 2) * 10]; c.update("none"); requestAnimationFrame(tick); }; tick();' });
    const started = Date.now();
    const result = await sweep('forever', ['/forever.html']);
    assert.equal(result.screenshots.length, Object.keys(VIEWPORTS).length);
    assert.ok(Date.now() - started < 90000, `took ${Date.now() - started} ms`);
  }, 120000);

  it.skipIf(!ready)('every scheme and language cell of a chart route sees reduced motion and shoots the final frame', async () => {
    pages['/matrix.html'] = page({ setup: 'mount(reduced ? false : { duration: 1000 });' });
    const result = await sweep('matrix', ['/matrix.html'], { schemes: ['light', 'dark'], langs: ['ro', 'en'] });
    assert.equal(result.screenshots.length, Object.keys(VIEWPORTS).length * 4);
    for (const suffix of ['light-ro', 'light-en', 'dark-ro', 'dark-en']) {
      const found = await probes('matrix', suffix);
      assert.equal(found.length, Object.keys(VIEWPORTS).length, suffix);
      for (const [shot, colour] of found) assert.equal(colour, 'red', shot);
    }
  }, 240000);

  describe('diffShots on a chart that is a few pixels short', () => {
    let dir;
    afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
    const bars = async (name, barHeight) => {
      const shots = join(dir, name, 'shots');
      mkdirSync(shots, { recursive: true });
      const bar = await sharp({ create: { width: 40, height: barHeight, channels: 3, background: '#8a4b00' } }).png().toBuffer();
      await sharp({ create: { width: 390, height: 300, channels: 3, background: '#ffffff' } })
        .composite([{ input: bar, left: 100, top: 250 - barHeight }]).png().toFile(join(shots, 'cockpit-mobile.png'));
      return join(dir, name);
    };

    it('flags a bar 6 px short of its final height as changed', async () => {
      dir = mkdtempSync(join(tmpdir(), 'diff-chart-'));
      const final = await bars('final', 120);
      const early = await bars('early', 114);
      const diff = await diffShots(early, final, join(dir, 'out'), { root });
      assert.equal(diff['shots/cockpit-mobile.png']?.status, 'changed');
    });

    it('flags a bar 20 px short of its final height as changed', async () => {
      dir = mkdtempSync(join(tmpdir(), 'diff-chart-'));
      const final = await bars('final', 120);
      const early = await bars('early', 100);
      const diff = await diffShots(early, final, join(dir, 'out'), { root });
      assert.equal(diff['shots/cockpit-mobile.png']?.status, 'changed');
    });
  });
});
