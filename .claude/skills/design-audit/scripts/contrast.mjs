#!/usr/bin/env node
// WCAG 2.1 contrast ratios for /design-audit. Computed, never recalled.
// Node built-ins only; no dependencies.
//
// Usage:
//   node contrast.mjs "#5C5C5C" "#FFFFFF"              one pair
//   node contrast.mjs --pairs pairs.txt                "<fg> <bg> [label]" per line
//   printf '#fff #000 hero\n' | node contrast.mjs --stdin
//   node contrast.mjs --fail-under 4.5 ...             exit 1 if any pair is below
//
// Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(), and bare
// "0 0% 100%" HSL triplets (shadcn / Tailwind CSS-variable tokens).
// A translucent foreground is composited over its background before measuring.

import { readFileSync } from 'node:fs';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Returns [r, g, b, a] with r/g/b in 0..255 and a in 0..1, or null.
export function parseColor(input) {
  const s = String(input).trim().toLowerCase().replace(/;$/, '');
  const named = { white: '#ffffff', black: '#000000', transparent: '#00000000' };
  const hex = (named[s] ?? s).match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    const wide = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    if (wide.length !== 6 && wide.length !== 8) return null;
    const n = (i) => parseInt(wide.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), wide.length === 8 ? n(6) / 255 : 1];
  }
  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  const parts = (fn ? fn[2] : s).split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p) => {
    const m = String(p).match(/^(-?\d*\.?\d+)(%|deg|turn|rad)?$/);
    return m ? { value: parseFloat(m[1]), unit: m[2] ?? '' } : null;
  };
  const v = parts.slice(0, 4).map(num);
  if (v.slice(0, 3).some((p) => p === null)) return null;
  const alpha = v[3] ? (v[3].unit === '%' ? v[3].value / 100 : v[3].value) : 1;
  const isHsl = fn ? fn[1].startsWith('hsl') : v[1].unit === '%' && v[2].unit === '%';
  const rgb = isHsl
    ? hslToRgb(
        v[0].unit === 'turn' ? v[0].value * 360 : v[0].unit === 'rad' ? (v[0].value * 180) / Math.PI : v[0].value,
        v[1].unit === '%' ? v[1].value / 100 : v[1].value,
        v[2].unit === '%' ? v[2].value / 100 : v[2].value,
      )
    : v.slice(0, 3).map((p) => (p.unit === '%' ? (p.value / 100) * 255 : p.value));
  return [...rgb.map((c) => clamp(c, 0, 255)), clamp(alpha, 0, 1)];
}

const channelLuminance = (c) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]) =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

const composite = (fg, bg) => fg.slice(0, 3).map((c, i) => fg[3] * c + (1 - fg[3]) * bg[i]);

// Contrast ratio of fg over bg, 1..21. Throws on an unparseable color.
export function contrastRatio(fgInput, bgInput) {
  const fg = parseColor(fgInput);
  const bg = parseColor(bgInput);
  if (!fg) throw new Error(`unparseable color: ${fgInput}`);
  if (!bg) throw new Error(`unparseable color: ${bgInput}`);
  const bgOpaque = bg[3] === 1 ? bg.slice(0, 3) : composite(bg, [255, 255, 255]);
  const l1 = luminance(composite(fg, bgOpaque));
  const l2 = luminance(bgOpaque);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args.splice(i, 2)[1];
  };
  const failUnder = take('--fail-under');
  const pairsFile = take('--pairs');
  const useStdin = args.includes('--stdin') && args.splice(args.indexOf('--stdin'), 1);
  const lines = [];
  if (pairsFile) lines.push(...readFileSync(pairsFile, 'utf8').split('\n'));
  if (useStdin) lines.push(...readFileSync(0, 'utf8').split('\n'));
  const pairs = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    // A line may use "|" to separate the fields, so that a bare HSL triplet
    // ("0 0% 100%"), which itself contains spaces, survives the split.
    .map((l) => (l.includes('|') ? l.split('|').map((f) => f.trim()) : l.split(/\s+/)))
    .filter((p) => p.length >= 2 && p[0] && p[1]);
  // Each CLI argument is already one field — never re-split it.
  if (args.length >= 2) pairs.push(args);
  if (pairs.length === 0) {
    console.error('usage: contrast.mjs <fg> <bg> | --pairs <file> | --stdin  [--fail-under N]');
    return 2;
  }
  const rows = pairs.map(([fg, bg, ...label]) => {
    try {
      return { fg, bg, label: label.join(' '), ratio: contrastRatio(fg, bg) };
    } catch (err) {
      return { fg, bg, label: label.join(' '), error: err.message };
    }
  });
  const mark = (ok) => (ok ? 'pass' : 'FAIL');
  const w = (s, n) => String(s).padEnd(n);
  console.log(`${w('FOREGROUND', 22)}${w('BACKGROUND', 22)}${w('RATIO', 9)}${w('BODY 4.5', 10)}${w('LARGE 3.0', 11)}${w('AAA 7.0', 9)}LABEL`);
  for (const r of rows) {
    if (r.error) {
      console.log(`${w(r.fg, 22)}${w(r.bg, 22)}${w('-', 9)}${w('-', 10)}${w('-', 11)}${w('-', 9)}${r.error}`);
      continue;
    }
    const ratio = `${r.ratio.toFixed(2)}:1`;
    console.log(
      `${w(r.fg, 22)}${w(r.bg, 22)}${w(ratio, 9)}${w(mark(r.ratio >= 4.5), 10)}${w(mark(r.ratio >= 3), 11)}${w(mark(r.ratio >= 7), 9)}${r.label}`,
    );
  }
  const bar = failUnder ? parseFloat(failUnder) : null;
  const failed = bar ? rows.filter((r) => r.error || r.ratio < bar) : [];
  if (bar) console.log(`\n${failed.length} of ${rows.length} pair(s) below ${bar}:1`);
  // An unparseable color is a bad input, not a passing pair — always exit non-zero.
  return failed.length > 0 || rows.some((r) => r.error) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
