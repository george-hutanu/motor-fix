import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const app = join(__dirname, '..');
const read = (path: string) => readFileSync(join(app, path), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const index = read('src/index.html');

type Icon = { purpose?: string; sizes: string; src: string; type: string };
const icons: Icon[] = manifest.icons;

const generator = `
import { Generator } from '@angular/service-worker/config';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const files = JSON.parse(process.argv[2]);
const fake = {
  list: async (dir) => files.filter((f) => f.startsWith(dir === '/' ? '/' : dir + '/')),
  read: async () => 'x',
  hash: async (f) => 'h' + f,
  write: async () => {},
};
process.stdout.write(JSON.stringify(await new Generator(fake, '/').process(config)));
`;

type Generated = {
  assetGroups: { name: string; urls: string[] }[];
  dataGroups: unknown[];
  navigationRequestStrategy: string;
  navigationUrls: { positive: boolean; regex: string }[];
};

function generate(files: string[]): Generated {
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      generator,
      join(app, 'ngsw-config.json'),
      JSON.stringify(files),
    ],
    { cwd: join(app, '../..'), encoding: 'utf8' },
  );
  return JSON.parse(out);
}

const built = [
  '/favicon.ico',
  '/index.csr.html',
  '/manifest.webmanifest',
  '/main-ABC123.js',
  '/chunk-XYZ.js',
  '/styles-QWE.css',
  '/icons/icon-192.png',
  '/media/font.woff2',
  '/api/garages',
  '/health/live',
];

describe('service worker as the build will generate it', () => {
  const generated = generate(built);
  const isNavigation = (url: string) => {
    const path = url.split(/[?#]/)[0];
    let result = false;
    for (const { positive, regex } of generated.navigationUrls) {
      if (new RegExp(regex).test(path)) result = positive;
    }
    return result;
  };

  it('keeps every api and health file out of the caches', () => {
    const cached = generated.assetGroups.flatMap((g) => g.urls);

    expect(cached.filter((url) => /^\/(api|health)\b/.test(url))).toEqual([]);
    expect(generated.dataGroups).toEqual([]);
  });

  it('prefetches the shell, scripts, styles and manifest', () => {
    const app = generated.assetGroups.find((g) => g.name === 'app');

    expect(app?.urls).toEqual(
      expect.arrayContaining([
        '/index.csr.html',
        '/main-ABC123.js',
        '/styles-QWE.css',
        '/manifest.webmanifest',
      ]),
    );
  });

  it('asks the server first for navigations', () => {
    expect(generated.navigationRequestStrategy).toBe('freshness');
  });

  for (const url of [
    '/api/garages',
    '/api/garages?city=Cluj',
    '/api/a/b/c',
    '/health/ready',
    '/main-ABC123.js',
    '/icons/icon-192.png',
    '/files/oferta.pdf',
  ]) {
    it(`does not treat ${url} as a page navigation`, () => {
      expect(isNavigation(url)).toBe(false);
    });
  }

  for (const url of [
    '/',
    '/cockpit',
    '/app/driver',
    '/garages/123',
    '/apiary',
    '/healthy-cars',
    '/cautare?q=anvelope+iarna',
  ]) {
    it(`treats ${url} as a page navigation`, () => {
      expect(isNavigation(url)).toBe(true);
    });
  }
});

describe('manifest under hostile reading', () => {
  it('is valid JSON with only string and object values the browser accepts', () => {
    expect(Object.keys(manifest).sort()).toEqual([
      'background_color',
      'display',
      'icons',
      'lang',
      'name',
      'scope',
      'short_name',
      'start_url',
      'theme_color',
    ]);
    for (const key of ['background_color', 'theme_color']) {
      expect(manifest[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps the start url and every icon inside the scope', () => {
    const base = new URL('https://motorfix.test/manifest.webmanifest');
    const scope = new URL(manifest.scope, base);

    expect(
      new URL(manifest.start_url, base).pathname.startsWith(scope.pathname),
    ).toBe(true);
    for (const icon of icons) {
      expect(new URL(icon.src, base).pathname.startsWith(scope.pathname)).toBe(
        true,
      );
    }
  });

  it('gives each icon file real, non-empty PNG content', () => {
    const signature = '89504e470d0a1a0a';
    for (const { src } of icons) {
      const file = join(app, 'public', src);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(100);
      expect(readFileSync(file).subarray(0, 8).toString('hex')).toBe(signature);
    }
  });

  it('draws the maskable icon apart from the plain 512 px icon', () => {
    const digest = (src: string) =>
      createHash('sha256')
        .update(readFileSync(join(app, 'public', src)))
        .digest('hex');
    const maskable = icons.find((i) => i.purpose === 'maskable');
    const plain = icons.find((i) => i.sizes === '512x512' && !i.purpose);

    expect(maskable).toBeDefined();
    expect(plain).toBeDefined();
    expect(digest((maskable as Icon).src)).not.toBe(
      digest((plain as Icon).src),
    );
  });

  it('never mixes the maskable purpose into an icon that is also shown plain', () => {
    for (const icon of icons) {
      expect(['maskable', undefined]).toContain(icon.purpose);
    }
  });

  it('links the manifest and the apple icon to files that exist in the public folder', () => {
    for (const href of [
      /rel="manifest" href="([^"]+)"/,
      /rel="apple-touch-icon" href="([^"]+)"/,
    ].map((re) => re.exec(index)?.[1])) {
      expect(existsSync(join(app, 'public', href ?? 'missing'))).toBe(true);
    }
  });
});

describe('page head', () => {
  it('declares exactly one viewport and no static browser bar colours of its own', () => {
    expect(index.match(/<meta name="viewport"/g)).toHaveLength(1);
    expect(index).not.toContain('name="theme-color"');
  });

  it('stays in Romanian and declares its encoding before the title', () => {
    expect(index).toContain('<html lang="ro">');
    expect(index.indexOf('charset="utf-8"')).toBeLessThan(
      index.indexOf('<title>'),
    );
  });
});
