/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';

import { mountStaticFiles } from './static-files';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

let folder: string;
let web: Server;
let base: string;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'static-files-'));
  mkdirSync(join(folder, 'chunks'));
  mkdirSync(join(folder, 'media'));
  mkdirSync(join(folder, 'icons'));
  mkdirSync(join(folder, 'map'));
  writeFileSync(join(folder, 'main-AB12CD34.js'), 'console.log(1);');
  writeFileSync(join(folder, 'chunk-Q7RZ2XKM.js'), 'console.log(2);');
  writeFileSync(join(folder, 'styles-5BXW7YTA.css'), 'body{}');
  writeFileSync(join(folder, 'media', 'inter-VQ3M6E2P.woff2'), 'font');
  writeFileSync(join(folder, 'main-AB12.js'), 'console.log(3);');
  for (const name of [
    'chunk-C0-vUTPR.js',
    'chunk--0e6RH5t.js',
    'chunk-y3Qh5uwH.js',
    'chunk-BzM_4dnW.js',
  ])
    writeFileSync(join(folder, name), name);
  for (const name of [
    'ngsw-worker.js',
    'ngsw.json',
    'manifest.webmanifest',
    'index.csr.html',
    'favicon.ico',
    'icons/icon-192.png',
    'icons/icon-maskable.png',
    'map/maplibre-gl-worker.mjs',
  ])
    writeFileSync(join(folder, name), name);
  writeFileSync(join(folder, 'main-AB12.js.map'), '{"version":3}');
  writeFileSync(join(folder, 'chunks', 'c-1.js.map'), '{"version":3}');
  writeFileSync(join(folder, 'styles.css.map'), '{"version":3}');
  const app = express();
  mountStaticFiles(app, folder);
  app.use((_req, res) => {
    res.status(404).send('next');
  });
  web = createServer(app);
  base = await listen(web);
});

afterAll(async () => {
  web.closeAllConnections();
  await new Promise((resolve) => web.close(resolve));
  rmSync(folder, { force: true, recursive: true });
});

const YEAR = 'public, max-age=31536000, immutable';

// @traces 877-FR-015 1201-FR-007
describe('the web server static files', () => {
  // @traces 1201-FR-001
  it.each([
    '/main-AB12CD34.js',
    '/chunk-Q7RZ2XKM.js',
    '/styles-5BXW7YTA.css',
    '/media/inter-VQ3M6E2P.woff2',
    '/chunk-C0-vUTPR.js',
    '/chunk--0e6RH5t.js',
    '/chunk-y3Qh5uwH.js',
    '/chunk-BzM_4dnW.js',
  ])(
    'keeps the content-hashed file %s for a year without asking again',
    async (path) => {
      const answer = await fetch(`${base}${path}`);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('cache-control')).toBe(YEAR);
    },
  );

  it('serves a hashed script whole', async () => {
    const answer = await fetch(`${base}/main-AB12CD34.js`);
    expect(await answer.text()).toBe('console.log(1);');
  });

  // @traces 1201-FR-002
  it.each([
    '/ngsw-worker.js',
    '/ngsw.json',
    '/manifest.webmanifest',
    '/index.csr.html',
    '/favicon.ico',
    '/icons/icon-192.png',
    '/icons/icon-maskable.png',
    '/map/maplibre-gl-worker.mjs',
    '/main-AB12.js',
    '/ngsw-worker.js?v=2',
  ])('makes the browser ask again before reusing %s', async (path) => {
    for (const method of ['GET', 'HEAD']) {
      const answer = await fetch(`${base}${path}`, { method });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('cache-control')).toBe('no-cache');
      expect(answer.headers.get('etag')).toBeTruthy();
    }
  });

  it('keeps a hashed file for a year on a HEAD request too', async () => {
    const answer = await fetch(`${base}/main-AB12CD34.js`, { method: 'HEAD' });
    expect(answer.headers.get('cache-control')).toBe(YEAR);
  });

  // @traces 1201-FR-003
  // fetch marks a conditional request no-cache itself, which forbids a 304.
  it('answers an unchanged file with 304 when the browser asks again', async () => {
    const first = await fetch(`${base}/ngsw-worker.js`);
    const etag = first.headers.get('etag') ?? '';
    const again = await new Promise<{ status?: number; cache?: string }>(
      (resolve, reject) =>
        get(
          `${base}/ngsw-worker.js`,
          { headers: { 'If-None-Match': etag } },
          (res) => {
            res.resume();
            resolve({
              cache: res.headers['cache-control'],
              status: res.statusCode,
            });
          },
        ).on('error', reject),
    );
    expect(again).toEqual({ cache: 'no-cache', status: 304 });
  });

  // @traces 1201-FR-004
  it.each([
    '/main-AB12.js.map',
    '/chunks/c-1.js.map',
    '/styles.css.map',
    '/main-AB12.js.map?x=1',
    '/MAIN-AB12.JS.MAP',
  ])('never serves the source map %s', async (path) => {
    const answer = await fetch(`${base}${path}`);
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('');
  });

  it.each(['/missing-AB12CD34.js', '/', '/icons'])(
    'leaves %s to the next handler',
    async (path) => {
      const answer = await fetch(`${base}${path}`, { redirect: 'manual' });
      expect(answer.status).toBe(404);
      expect(await answer.text()).toBe('next');
    },
  );
});
