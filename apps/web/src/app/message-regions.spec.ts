import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
