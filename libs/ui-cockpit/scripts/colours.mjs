// Writes src/generated/colours.ts from the token blocks of src/styles/cockpit.css:
// every colour token (the names the light set declares) by scheme, for what
// cannot read a CSS variable (a theme-color meta tag, an e-mail). With
// --check it writes nothing and exits 1 when the file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';

// Comments go first: a brace or a token inside one is not the stylesheet's.
const css = readFileSync(
  new URL('../src/styles/cockpit.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const out = new URL('../src/generated/colours.ts', import.meta.url);

function tokens(pattern) {
  const body = pattern.exec(css)?.[1];
  if (!body) throw new Error(`cockpit.css has no block matching ${pattern}`);
  return new Map(
    [...body.matchAll(/(--mf-[\w-]+)\s*:\s*([^;]+);/g)].map(([, n, v]) => [
      n,
      v.trim(),
    ]),
  );
}

const dark = tokens(/^:root\s*\{([^}]*)\}/m);
const light = tokens(
  /@media \(prefers-color-scheme: light\)[^{]*\{\s*:root\s*\{([^}]*)\}/,
);

function entries(values) {
  return [...light.keys()]
    .sort()
    .map((name) => {
      if (!values.has(name)) throw new Error(`the dark set has no ${name}`);
      return `    '${name}': '${values.get(name)}',`;
    })
    .join('\n');
}

const source = `// Generated from styles/cockpit.css by libs/ui-cockpit/scripts/colours.mjs; do not edit.
export const COCKPIT_COLOURS = {
  dark: {
${entries(dark)}
  },
  light: {
${entries(light)}
  },
} as const;
`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {}
  if (current !== source) {
    process.stderr.write(
      'libs/ui-cockpit/src/generated/colours.ts is out of date: run node libs/ui-cockpit/scripts/colours.mjs\n',
    );
    process.exit(1);
  }
} else {
  writeFileSync(out, source);
}
