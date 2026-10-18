import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// An empty error, warning or status region hidden with `display: none` leaves
// the accessibility tree, so a screen reader misses the first message put in
// it. Every message region carries `mf-message`, whose one global rule hides
// it visually while empty, and no screen stylesheet hides one with display.
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

// Each template whose stylesheet hid its message regions when empty, with the
// classes those rules named.
const REGIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['dashboard/frame/frame.html', ['live-offline']],
  [
    'dashboard/garage-requests/send-quote-dialog/send-quote-dialog.html',
    ['error'],
  ],
  ['dashboard/job-steps/job-steps.html', ['problem']],
  ['home/place/place-dialog/place-dialog.html', ['message']],
  ['public/brands-step/brands-step.html', ['error']],
  ['public/contact/contact-form/contact-form.html', ['status']],
  ['public/details-step/details-step.html', ['error']],
  ['public/garage-profile/request-quote/request-quote.html', ['error']],
  ['public/hours-step/hours-step.html', ['error', 'warning']],
  ['public/list-your-garage/list-your-garage.html', ['error', 'warning']],
  ['public/mechanics-step/mechanics-step.html', ['error']],
  ['public/photos-step/photos-step.html', ['error', 'warning']],
  ['public/place-step/place-step.html', ['error', 'warning']],
  ['public/prices-step/prices-step.html', ['error']],
  ['sign-in/consent/consent.html', ['error']],
];

// Every opening tag in a template, with its static class list and the text
// of its [class] binding.
function tags(html: string) {
  return [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map(
    ([tag, , attributes]) => ({
      bound: attributes.match(/\[class\]="([^"]*)"/)?.[1] ?? '',
      classes: (attributes.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? '')
        .split(/\s+/)
        .filter(Boolean),
      tag: tag.replace(/\s+/g, ' ').slice(0, 120),
    }),
  );
}

// @traces 248-FR-009
// @traces 248-FR-008
describe('message regions', () => {
  it.each(REGIONS)('%s marks every %p region mf-message', (template, names) => {
    const regions = tags(read(template)).filter(({ bound, classes }) =>
      names.some(
        (name) => classes.includes(name) || bound.includes(`'${name}'`),
      ),
    );

    expect(regions.length).toBeGreaterThan(0);
    expect(
      regions
        .filter(({ classes }) => !classes.includes('mf-message'))
        .map(({ tag }) => tag),
    ).toEqual([]);
  });

  // Layout containers keep their own rule: an empty list or section has
  // nothing to announce.
  const LAYOUT = [
    '.suggestions:empty',
    '.sections section:empty',
    '.lines:empty',
    ':host:empty',
  ];

  function stylesheets(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return stylesheets(path);
      return entry.name.endsWith('.css') ? [path] : [];
    });
  }

  it('leaves no screen stylesheet hiding an empty message region with display: none', () => {
    const hidden = stylesheets(__dirname).flatMap((path) => {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => /display:\s*none/.test(body))
        .flatMap(([, head]) => head.split(','))
        .map((selector) => selector.trim().replace(/\s+/g, ' '))
        .filter(
          (selector) =>
            /:empty/.test(selector.replace(/:not\(:empty\)/g, '')) &&
            !LAYOUT.includes(selector),
        )
        .map((selector) => `${path.slice(__dirname.length + 1)}: ${selector}`);
    });

    expect(hidden).toEqual([]);
  });
});

// `.mf-message:empty` matches a region holding nothing or only comments, never
// one holding a whitespace text node. Angular drops whitespace-only text nodes
// (and the anchors of a false @if are comments), but a text node holding an
// interpolation keeps the spaces beside it: `<p class="mf-message"> {{ m() }} </p>`
// renders " " while m() is empty and the region would sit in the layout.
// Each region's interpolations therefore touch its tags, or live in a block.
const CONTROL =
  /^@(if|else|switch|case|default|for|empty|defer|placeholder|loading|error)\b/;

// Where the block opening at `start` ends: past its head `(...)` to the
// first `{`, then past the brace that closes it.
function blockEnd(inner: string, start: number): number {
  const head = /^@[a-z]+\s*(\((?:[^()]|\([^()]*\))*\))?/.exec(
    inner.slice(start),
  );
  let j = inner.indexOf('{', start + (head?.[0].length ?? 1));
  if (j < 0) return inner.length;
  let depth = 0;
  do {
    depth += inner[j] === '{' ? 1 : inner[j] === '}' ? -1 : 0;
    j++;
  } while (depth > 0 && j < inner.length);
  return j;
}

// A region's own content with every control-flow block and comment removed.
function topLevel(inner: string): string {
  let out = '';
  let i = 0;
  while (i < inner.length) {
    const rest = inner.slice(i);
    if (rest.startsWith('<!--')) i = inner.indexOf('-->', i) + 3;
    else if (CONTROL.test(rest)) i = blockEnd(inner, i);
    else out += inner[i++];
  }
  return out;
}

// Every element carrying mf-message in its static class, with its content.
function regions(html: string) {
  return [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)]
    .filter(([, , attributes]) =>
      /(?:^|\s)class="(?:[^"]*\s)?mf-message(?:\s[^"]*)?"/.test(attributes),
    )
    .map((match) => {
      const [open, name] = match;
      const start = (match.index ?? 0) + open.length;
      const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
      let depth = 1;
      let end = html.length;
      for (const next of html.slice(start).matchAll(tag)) {
        depth += next[1] ? -1 : 1;
        if (depth === 0) {
          end = start + (next.index ?? 0);
          break;
        }
      }
      return {
        inner: html.slice(start, end),
        open: open.replace(/\s+/g, ' ').slice(0, 120),
      };
    });
}

// True when the region's text could render as whitespace only: an
// interpolation outside any block with nothing but whitespace beside it.
function whitespaceWhenEmpty(inner: string): boolean {
  const own = topLevel(inner);
  if (!/\{\{[\s\S]*?\}\}/.test(own) || /<[a-z]/i.test(own)) return false;
  const rest = own.replace(/\{\{[\s\S]*?\}\}/g, '');
  return rest.length > 0 && rest.trim() === '';
}

function templates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return templates(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

// @traces 248-FR-009
describe('message region content', () => {
  it('flags whitespace beside an interpolation and passes the safe forms', () => {
    expect(whitespaceWhenEmpty(' {{ m() }} ')).toBe(true);
    expect(whitespaceWhenEmpty('\n  {{ m() | t }}\n')).toBe(true);
    expect(whitespaceWhenEmpty('@if (a) {x} {{ m() }}')).toBe(true);
    expect(whitespaceWhenEmpty('{{ m() }}')).toBe(false);
    expect(
      whitespaceWhenEmpty('\n  @if (m(); as k) {\n    {{ k | t }}\n  }\n'),
    ).toBe(false);
    expect(whitespaceWhenEmpty('@if (m()) {{{ k | t }}}')).toBe(false);
    expect(whitespaceWhenEmpty('{{ a }} · {{ b }}')).toBe(false);
  });

  it('finds every region in the web templates', () => {
    const found = templates(__dirname).flatMap((path) =>
      regions(readFileSync(path, 'utf8')),
    );

    expect(found.length).toBeGreaterThan(30);
  });

  it('leaves no region rendering whitespace when its message is empty', () => {
    const offenders = templates(__dirname).flatMap((path) =>
      regions(readFileSync(path, 'utf8'))
        .filter(({ inner }) => whitespaceWhenEmpty(inner))
        .map(({ open }) => `${relative(__dirname, path)}: ${open}`),
    );

    expect(offenders).toEqual([]);
  });
});
