/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
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
  writeFileSync(join(folder, 'main-AB12.js'), 'console.log(1);');
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

// @traces 877-FR-015
describe('the web server static files', () => {
  it('serves a built script with a year-long cache', async () => {
    const answer = await fetch(`${base}/main-AB12.js`);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('console.log(1);');
    expect(answer.headers.get('cache-control')).toContain('max-age=31536000');
  });

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
});
