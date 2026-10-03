import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contrastRatio, parseColor } from './contrast.mjs';

// These guard the /design-audit helper scripts, not the taskr CLI. Contrast math
// is the part whose wrongness is invisible in a report, so it is pinned to known
// WCAG values here.

const SCAN = new URL('./scan.mjs', import.meta.url).pathname;

describe('contrast.mjs — parseColor', () => {
  it('reads every accepted color notation as the same gray', () => {
    const gray = [92, 92, 92, 1];
    for (const notation of ['#5c5c5c', '#5C5C5C', 'rgb(92,92,92)', 'rgb(92 92 92)']) {
      assert.deepEqual(parseColor(notation), gray, notation);
    }
  });

  it('expands shorthand hex and reads hex alpha', () => {
    assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('#000000ff'), [0, 0, 0, 1]);
    assert.equal(parseColor('#00000080')[3], 128 / 255);
  });

  it('reads hsl() and bare HSL token triplets', () => {
    assert.deepEqual(parseColor('hsl(0,0%,100%)'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('0 0% 0%'), [0, 0, 0, 1]);
  });

  it('returns null for junk', () => {
    for (const junk of ['bogus', '', 'rgb(1,2)']) assert.equal(parseColor(junk), null, junk);
  });
});

describe('contrast.mjs — contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    assert.equal(contrastRatio('#000', '#fff').toFixed(2), '21.00');
    assert.equal(contrastRatio('#fff', '#fff').toFixed(2), '1.00');
    // #767676 on white is the canonical 4.5:1 boundary gray.
    assert.equal(contrastRatio('#767676', '#ffffff').toFixed(2), '4.54');
    assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
  });

  it('is symmetric — order of the pair cannot change the ratio', () => {
    assert.equal(contrastRatio('#5c5c5c', '#fff'), contrastRatio('#fff', '#5c5c5c'));
  });

  it('composites a translucent foreground over its background', () => {
    // black at 60% over white is the same ink as #666.
    assert.equal(
      contrastRatio('rgba(0,0,0,0.6)', '#fff').toFixed(2),
      contrastRatio('#666666', '#fff').toFixed(2),
    );
  });

  it('throws on an unparseable color rather than returning a number', () => {
    assert.throws(() => contrastRatio('bogus', '#fff'), /unparseable color: bogus/);
  });
});

describe('scan.mjs', () => {
  it('locates type, spacing, motion and smells with file:line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'design-audit-'));
    try {
      writeFileSync(
        join(dir, 'app.css'),
        '.hero { font-size: 32px; padding: 48px 52px; gap: 18px; }\n' +
          '.btn { transition: all 0.6s linear; }\n',
      );
      const out = execFileSync('node', [SCAN, dir], { encoding: 'utf8' });

      assert.match(out, /32px\s+1x\s+.*app\.css:1/);
      assert.match(out, /52px\s+1x\s+.*app\.css:1/);
      assert.match(out, /600ms\s+1x\s+.*app\.css:2/);
      assert.match(out, /transition: all/);
      // 52px sits on the 4px grid — only 18px is off it. The 48/52 pair is an
      // inconsistency for the reader to judge, not something the scan flags.
      assert.match(out, /off a 4px grid: 18px/);
      assert.doesNotMatch(out, /off a 4px grid:.*52px/);
      assert.match(out, /over 300ms: 600ms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not read a JSX style object as spacing it is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'design-audit-'));
    try {
      writeFileSync(join(dir, 'Hero.tsx'), 'const s = { padding: 24, fontSize: 44 };\n');
      const out = execFileSync('node', [SCAN, dir], { encoding: 'utf8' });
      const spacing = out.split('## SPACING VALUES')[1]?.split('##')[0] ?? '';

      assert.match(spacing, /24px/);
      assert.doesNotMatch(spacing, /44px/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
