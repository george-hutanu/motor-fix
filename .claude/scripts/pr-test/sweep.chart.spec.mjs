// ST-1349: the sweep shoots a Chart.js chart at its final frame, the same on every run, so an unchanged
// /cockpit never shows as a changed chart. Each mechanism has its own spec in sweep.spec.mjs (reduced motion
// in contextOptions, settleCanvases, settleFonts); this one drives runSweep itself over a page drawn the way
// the cockpit's charts are (fixtures/chart/cockpit-chart.html), twice, and compares the shots as the PR QA
// workflow's visual diff does (baseline.mjs diffShots).
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diffShots } from './baseline.mjs';
import { runSweep, VIEWPORTS } from './sweep.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const fixtures = fileURLToPath(new URL('./fixtures/chart/', import.meta.url));
// The probe canvas's box in the fixture, in CSS pixels.
const PROBE = { x: 60, y: 3 };

// The probe's colour where its bar's top stands when drawn to the end: red when the page saw reduced
// motion, blue when it did not, white (the page) while the bar is still rising.
async function probeColour(sharp, shot, scale) {
  const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (Math.round(PROBE.y * scale) * info.width + Math.round(PROBE.x * scale)) * info.channels;
  const [r, g, b] = data.subarray(at, at + 3);
  if (r > 200 && g < 60 && b < 60) return 'red';
  if (b > 200 && r < 60 && g < 60) return 'blue';
  return `rgb(${r}, ${g}, ${b})`;
}

describe('the sweep shoots a canvas chart finished, the same on every run (ST-1349)', async () => {
  let ready = true;
  try {
    const { chromium } = await import('@playwright/test');
    await (await chromium.launch()).close();
  } catch (error) {
    if (process.env.CI) throw error;
    ready = false;
  }
  const chartJs = require.resolve('chart.js').replace(/chart\.(c?js|mjs)$/, 'chart.umd.js');
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/chart.umd.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(chartJs));
      const body = await readFile(join(fixtures, path.replace(/^\/+/, '')));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const work = mkdtempSync(join(tmpdir(), 'sweep-chart-'));
  afterAll(() => {
    server.close();
    rmSync(work, { recursive: true, force: true });
  });
  // As run.mjs does: the shots go to <out>/shots, where diffShots reads them.
  const sweep = (name) => runSweep({ baseURL, routes: ['/cockpit-chart.html'], outDir: join(work, name, 'shots'), schemes: ['light'], langs: ['en'], repoRoot: root });

  // @traces 1349-FR-001 @traces 1349-FR-002
  it.skipIf(!ready)('two sweeps of an unchanged chart page shoot the same finished chart at every viewport', async () => {
    const first = await sweep('first');
    const second = await sweep('second');
    assert.equal(first.screenshots.length, Object.keys(VIEWPORTS).length);
    assert.equal(second.screenshots.length, first.screenshots.length);

    // FR-001: the visual diff finds nothing between the two runs.
    const diff = await diffShots(join(work, 'second'), join(work, 'first'), join(work, 'diff'), { root });
    assert.equal(Object.keys(diff).length, first.screenshots.length);
    for (const [shot, outcome] of Object.entries(diff)) assert.equal(outcome.status, 'identical', `${shot}: ${JSON.stringify(outcome.regions ?? outcome.status)}`);

    // FR-002: every shot holds the chart's final frame, drawn without its entry animation.
    const sharp = require('sharp');
    const shots = readdirSync(join(work, 'first', 'shots'));
    for (const [viewport, { deviceScaleFactor }] of Object.entries(VIEWPORTS)) {
      const shot = shots.find((s) => s.endsWith(`-${viewport}-light-en.png`));
      assert.ok(shot, `no shot at ${viewport}`);
      assert.equal(await probeColour(sharp, join(work, 'first', 'shots', shot), deviceScaleFactor), 'red', `${shot}: the probe bar's top`);
    }
  }, 120000);
});
