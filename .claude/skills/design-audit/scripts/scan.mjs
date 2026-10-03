#!/usr/bin/env node
// Design-value locator for /design-audit. Node built-ins only; no dependencies.
//
// Reports every type size, spacing value, transition and color it can find, with
// file:line and a frequency count. It LOCATES and COUNTS — it does not judge.
// The flags at the bottom are candidates to verify by reading the file, not findings.
//
// Usage:
//   node scan.mjs src/                       scan a tree
//   node scan.mjs src/app.css src/Hero.tsx   scan named files
//   node scan.mjs src/ --samples 8           more file:line samples per value
//   node scan.mjs src/ --json                machine-readable
//
// Known blind spots, by design: the `font:` shorthand, values that live only in a
// design-token file the scan never opened, Tailwind's default scale (`p-4`, `text-sm`
// — read the theme instead), and anything computed at runtime.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.html', '.svelte', '.vue', '.astro',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'vendor', '.venv']);
const MAX_BYTES = 2_000_000;

function collect(target, acc = []) {
  const stats = statSync(target);
  if (stats.isFile()) {
    if (EXTENSIONS.has(extname(target)) && stats.size <= MAX_BYTES) acc.push(target);
    return acc;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) collect(join(target, entry.name), acc);
    } else if (entry.isFile()) {
      collect(join(target, entry.name), acc);
    }
  }
  return acc;
}

const px = (n, unit) => {
  const value = parseFloat(n);
  if (!Number.isFinite(value)) return null;
  return unit && unit !== 'px' ? `${value}${unit}` : `${value}px`;
};

// Each matcher returns the normalized values found on one line.
const MATCHERS = [
  {
    kind: 'type',
    scan(line) {
      const out = [];
      for (const m of line.matchAll(/(?:font-size|fontSize)\s*[:=]\s*["'{]?\s*(-?\d*\.?\d+)(px|rem|em|pt|%)?/gi)) {
        const v = px(m[1], m[2]);
        if (v) out.push(v);
      }
      for (const m of line.matchAll(/\btext-\[(-?\d*\.?\d+)(px|rem|em|pt)?\]/g)) {
        const v = px(m[1], m[2]);
        if (v) out.push(v);
      }
      return out;
    },
  },
  {
    kind: 'spacing',
    scan(line) {
      const out = [];
      const props = /\b(?:padding|margin|gap|row-gap|column-gap|inset)(?:-(?:top|right|bottom|left|inline|block|start|end|x|y))?\s*:\s*([^;{}\n,]+)/gi;
      const camel = /\b(?:padding|margin|gap)(?:Top|Right|Bottom|Left|Inline|Block|X|Y)?\s*:\s*["'{]?\s*(-?\d*\.?\d+)(px|rem|em)?/g;
      for (const m of line.matchAll(props)) {
        for (const t of m[1].matchAll(/(-?\d*\.?\d+)(px|rem|em)?\b/g)) {
          const v = px(t[1], t[2]);
          if (v && parseFloat(t[1]) !== 0) out.push(v);
        }
      }
      for (const m of line.matchAll(camel)) {
        const v = px(m[1], m[2]);
        if (v && parseFloat(m[1]) !== 0) out.push(v);
      }
      for (const m of line.matchAll(/\b(?:[pm][trblxy]?|gap(?:-[xy])?|space-[xy])-\[(-?\d*\.?\d+)(px|rem|em)?\]/g)) {
        const v = px(m[1], m[2]);
        if (v) out.push(v);
      }
      return out;
    },
  },
  {
    kind: 'duration',
    scan(line) {
      if (!/transition|animation|duration/i.test(line)) return [];
      const out = [];
      for (const m of line.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        const value = parseFloat(m[1]);
        if (Number.isFinite(value)) out.push(`${m[2] === 's' ? value * 1000 : value}ms`);
      }
      for (const m of line.matchAll(/\bduration-\[?(\d+)(ms|s)?\]?/g)) {
        out.push(`${m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1])}ms`);
      }
      return out;
    },
  },
  {
    kind: 'easing',
    scan(line) {
      if (!/transition|animation|ease|cubic-bezier|timing-function/i.test(line)) return [];
      const out = [];
      const curves = /cubic-bezier\(\s*[^)]*\)|steps\(\s*[^)]*\)|\bease-in-out\b|\bease-in\b|\bease-out\b|\bease\b|\blinear\b/g;
      for (const m of line.matchAll(curves)) out.push(m[0].replace(/\s+/g, ''));
      return out;
    },
  },
  {
    kind: 'color',
    scan(line) {
      const out = [];
      for (const m of line.matchAll(/#[0-9a-f]{3,8}\b/gi)) out.push(m[0].toLowerCase());
      for (const m of line.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/gi)) out.push(m[0].replace(/\s+/g, ''));
      return out;
    },
  },
  {
    kind: 'smell',
    scan(line) {
      const out = [];
      if (/transition\s*:\s*all\b/i.test(line)) out.push('transition: all');
      if (/!important/.test(line)) out.push('!important');
      const z = line.match(/\bz-index\s*:\s*(\d{4,})/i);
      if (z) out.push(`z-index: ${z[1]}`);
      return out;
    },
  },
];

function scan(files, cwd) {
  const hits = new Map();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const relPath = relative(cwd, file);
    const rel = !relPath || relPath.startsWith('..') ? file : relPath;
    text.split('\n').forEach((line, i) => {
      if (line.length > 2000) return;
      const seen = new Set();
      for (const matcher of MATCHERS) {
        for (const value of matcher.scan(line)) {
          const key = `${matcher.kind} ${value}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const hit = hits.get(key) ?? { kind: matcher.kind, value, count: 0, locations: [] };
          hit.count += 1;
          hit.locations.push(`${rel}:${i + 1}`);
          hits.set(key, hit);
        }
      }
    });
  }
  return [...hits.values()];
}

const toPx = (value) => {
  const m = String(value).match(/^(-?\d*\.?\d+)(px|rem|em|ms)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
};

function report(hits, samples) {
  const byKind = (kind) => hits.filter((h) => h.kind === kind);
  const numeric = (a, b) => (toPx(a.value) ?? 0) - (toPx(b.value) ?? 0);
  const byCount = (a, b) => b.count - a.count;
  const section = (title, rows, sort) => {
    if (rows.length === 0) return;
    console.log(`\n## ${title} (${rows.length} distinct)`);
    for (const h of [...rows].sort(sort)) {
      const shown = h.locations.slice(0, samples).join(', ');
      const more = h.locations.length > samples ? ` +${h.locations.length - samples} more` : '';
      console.log(`  ${String(h.value).padEnd(22)} ${String(h.count).padStart(4)}x  ${shown}${more}`);
    }
  };

  section('TYPE SIZES', byKind('type'), numeric);
  section('SPACING VALUES', byKind('spacing'), numeric);
  section('DURATIONS', byKind('duration'), numeric);
  section('EASING CURVES', byKind('easing'), byCount);
  section('COLORS', byKind('color'), byCount);
  section('SMELLS', byKind('smell'), byCount);

  const flags = [];
  const types = byKind('type');
  if (types.length > 5) flags.push(`${types.length} distinct type sizes — a scale usually needs 4 to 6.`);
  const offGrid = byKind('spacing').filter((h) => {
    const v = toPx(h.value);
    return v !== null && v % 4 !== 0;
  });
  if (offGrid.length) flags.push(`off a 4px grid: ${offGrid.map((h) => h.value).join(', ')}`);
  const slow = byKind('duration').filter((h) => (toPx(h.value) ?? 0) > 300);
  if (slow.length) flags.push(`over 300ms: ${slow.map((h) => `${h.value} (${h.count}x)`).join(', ')}`);
  const linear = byKind('easing').find((h) => h.value === 'linear');
  if (linear) flags.push(`linear easing used ${linear.count}x — check each is a fade or a progress indicator.`);
  const colors = byKind('color');
  if (colors.length > 12) flags.push(`${colors.length} distinct colors — check these resolve to a token set.`);
  for (const h of byKind('smell')) flags.push(`${h.value} — ${h.count}x`);

  console.log('\n## FLAGS (candidates to verify by reading, not findings)');
  if (flags.length === 0) console.log('  none');
  for (const f of flags) console.log(`  - ${f}`);
  console.log('\nContrast is NOT scanned: pair each color with its real background, then run contrast.mjs.');
}

function main(argv) {
  const args = [...argv];
  const json = args.includes('--json');
  const sIndex = args.indexOf('--samples');
  const samples = sIndex === -1 ? 4 : parseInt(args.splice(sIndex, 2)[1], 10) || 4;
  const targets = args.filter((a) => !a.startsWith('--'));
  if (targets.length === 0) {
    console.error('usage: scan.mjs <path>... [--samples N] [--json]');
    return 2;
  }
  const cwd = process.cwd();
  const files = [];
  for (const t of targets) {
    try {
      collect(t, files);
    } catch (err) {
      console.error(`skipped ${t}: ${err.message}`);
    }
  }
  if (files.length === 0) {
    console.error('no scannable files found (looked for CSS/HTML/JS/TS/JSX/TSX/Svelte/Vue/Astro)');
    return 2;
  }
  const hits = scan(files, cwd);
  if (json) {
    console.log(JSON.stringify({ files: files.length, hits }, null, 2));
    return 0;
  }
  console.log(`# design scan — ${files.length} file(s)`);
  report(hits, samples);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
