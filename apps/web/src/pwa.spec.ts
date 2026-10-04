import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = join(__dirname, '..');
const read = (path: string) => readFileSync(join(app, path), 'utf8');
const json = (path: string) => JSON.parse(read(path));

const index = read('src/index.html');
const manifest = json('public/manifest.webmanifest');
const ngsw = json('ngsw-config.json');
const darkBackground = /--mf-bg:\s*([^;]+);/.exec(
  readFileSync(
    join(app, '../../libs/ui-cockpit/src/styles/cockpit.css'),
    'utf8',
  ),
)?.[1];

// Width and height from the PNG header.
function pngSize(path: string): [number, number] {
  const png = readFileSync(join(app, 'public', path));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('viewport', () => {
  it('fits the device, reaches under the notch and never disables zoom', () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(index)?.[1];

    expect(viewport).toBe(
      'width=device-width, initial-scale=1, viewport-fit=cover',
    );
    expect(index).not.toMatch(/user-scalable|maximum-scale/);
  });
});

describe('web app manifest', () => {
  it('is linked from the page, with an icon for the iPhone home screen', () => {
    expect(index).toContain(
      '<link rel="manifest" href="manifest.webmanifest" />',
    );
    expect(index).toContain(
      '<link rel="apple-touch-icon" href="icons/icon-192.png" />',
    );
  });

  it('installs as MotorFix, full screen, opening on the home page', () => {
    expect(manifest).toMatchObject({
      display: 'standalone',
      lang: 'ro',
      name: 'MotorFix',
      short_name: 'MotorFix',
      start_url: '/',
    });
  });

  it('takes the dark page background as its theme and splash colour', () => {
    expect(darkBackground).toBe('#0b0c0e');
    expect(manifest.theme_color).toBe(darkBackground);
    expect(manifest.background_color).toBe(darkBackground);
  });

  it('carries 192 and 512 px icons and a maskable one, at their stated sizes', () => {
    const icons = manifest.icons as {
      purpose?: string;
      sizes: string;
      src: string;
      type: string;
    }[];

    expect(
      icons.map(({ purpose = 'any', sizes }) => `${sizes} ${purpose}`),
    ).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const { sizes, src, type } of icons) {
      expect(type).toBe('image/png');
      expect(existsSync(join(app, 'public', src))).toBe(true);
      expect(pngSize(src).join('x')).toBe(sizes);
    }
  });
});

describe('service worker', () => {
  it('caches the app shell and the static files', () => {
    expect(ngsw.index).toBe('/index.csr.html');
    const files = ngsw.assetGroups.flatMap(
      (group: { resources: { files: string[] } }) => group.resources.files,
    );
    expect(files).toEqual(
      expect.arrayContaining([
        '/index.csr.html',
        '/manifest.webmanifest',
        '/*.css',
        '/*.js',
        '/icons/**',
      ]),
    );
  });

  it('never caches an API answer', () => {
    expect(ngsw.dataGroups ?? []).toEqual([]);
    const files: string[] = ngsw.assetGroups.flatMap(
      (group: { resources: { files: string[] } }) => group.resources.files,
    );
    expect(files.filter((f) => /api|health/.test(f))).toEqual([]);
  });

  it('sends navigations to the server first, and never answers an API address', () => {
    expect(ngsw.navigationRequestStrategy).toBe('freshness');
    expect(ngsw.navigationUrls).toEqual(
      expect.arrayContaining(['/**', '!/api/**', '!/health/**']),
    );
  });

  it('is built into the production build only', () => {
    const build = json('project.json').targets.build;

    expect(build.configurations.production.serviceWorker).toBe(
      'apps/web/ngsw-config.json',
    );
    expect(build.options.serviceWorker).toBeUndefined();
    expect(build.configurations.development.serviceWorker).toBeUndefined();
  });
});
