/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';

import { mountStaticFiles } from './static-files';

const YEAR = 'public, max-age=31536000, immutable';

let root: string;
let web: Server;
let port: number;

const raw = (
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
) =>
  new Promise<{
    status?: number;
    headers: Record<string, unknown>;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      { headers, host: '127.0.0.1', method, path, port },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ body, headers: res.headers, status: res.statusCode }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'static-adv-'));
  const folder = join(root, 'site');
  mkdirSync(folder);
  mkdirSync(join(folder, 'deep'));
  writeFileSync(join(root, 'secret.txt'), 'outside');
  writeFileSync(join(folder, 'inside.txt'), 'inside');
  const names = [
    'main-abcdefgh.js',
    'main-________.js',
    'main-AB12CD345.js',
    'main-AB12CD3.js',
    'main-ABCDEFGH.js',
    'main-12345678.js',
    'main-a_b-c_d1.js',
    'my-app-name-AB12CD34.js',
    'main-AB12CD34.mjs',
    'main-AB12CD34.js.gz',
    'main-AB12CD34.json',
    'main-AB12CD34',
    'main-ÄB12CD34.js',
    'main-AB12CD34.JS',
    'MAIN-AB12CD34.js',
    'main-AB12.js.map',
    'main-AB12CD34.js.map',
    'empty.js',
  ];
  for (const n of names) writeFileSync(join(folder, n), n);
  writeFileSync(join(folder, 'deep', 'x-AB12CD34.js'), 'deep');
  writeFileSync(join(folder, 'deep', 'a.js.map'), '{}');
  const app = express();
  mountStaticFiles(app, folder);
  app.use((_req, res) => {
    res.status(404).send('next');
  });
  web = createServer(app);
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  port = (web.address() as AddressInfo).port;
});

afterAll(async () => {
  web.closeAllConnections();
  await new Promise((resolve) => web.close(resolve));
  rmSync(root, { force: true, recursive: true });
});

describe('static files under hostile requests', () => {
  it.each([
    '/main-abcdefgh.js',
    '/main-________.js',
    '/main-AB12CD345.js',
    '/main-AB12CD3.js',
    '/main-AB12CD34.js.gz',
    '/main-AB12CD34',
    '/main-ÄB12CD34.js',
  ])('treats %s as not content-hashed', async (path) => {
    const res = await raw(encodeURI(path));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it.each([
    '/main-ABCDEFGH.js',
    '/main-12345678.js',
    '/main-a_b-c_d1.js',
    '/my-app-name-AB12CD34.js',
    '/main-AB12CD34.mjs',
    '/main-AB12CD34.json',
    '/main-AB12CD34.JS',
    '/MAIN-AB12CD34.js',
    '/deep/x-AB12CD34.js',
  ])('keeps %s for a year', async (path) => {
    const res = await raw(path);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(YEAR);
  });

  it('keeps the year on an unchanged hashed file answered 304', async () => {
    const first = await raw('/main-ABCDEFGH.js');
    const res = await raw('/main-ABCDEFGH.js', {
      'If-None-Match': String(first.headers['etag']),
    });
    expect(res.status).toBe(304);
    expect(res.headers['cache-control']).toBe(YEAR);
  });

  it('accepts a weak validator for a revalidated file', async () => {
    const first = await raw('/inside.txt');
    const res = await raw('/inside.txt', {
      'If-None-Match': `W/${String(first.headers['etag']).replace(/^W\//, '')}`,
    });
    expect(res.status).toBe(304);
  });

  it('sends the whole file when the validator is stale', async () => {
    const res = await raw('/inside.txt', { 'If-None-Match': '"stale"' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('inside');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves a zero-byte file with its no-cache header and an ETag', async () => {
    const res = await raw('/empty.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['etag']).toEqual(expect.any(String));
  });

  it('keeps no-cache on a ranged answer', async () => {
    const res = await raw('/inside.txt', { Range: 'bytes=0-2' });
    expect(res.status).toBe(206);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('ins');
  });

  it.each([
    '/main-AB12.js%2Emap',
    '/main-AB12.js%2emap',
    '/main-AB12CD34.js.map?download=1',
    '/deep/../main-AB12.js.map',
    '/main-AB12.js.Map',
  ])('answers 404 for the source map %s', async (path) => {
    const res = await raw(path);
    expect(res.status).toBe(404);
    expect(res.body).toBe('');
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/deep/%2e%2e/%2e%2e/secret.txt',
  ])('never reaches outside the folder through %s', async (path) => {
    const res = await raw(path);
    expect(res.body).not.toBe('outside');
  });

  it('survives a malformed percent escape without a server error', async () => {
    const res = await raw('/%E0%A4%A');
    expect(res.status).toBeLessThan(500);
  });

  it('does not answer a null byte with a file', async () => {
    const res = await raw('/inside.txt%00.js');
    expect(res.status).not.toBe(200);
  });

  it.each(['POST', 'PUT', 'DELETE'])(
    'passes a %s on an existing file to the next handler',
    async (method) => {
      const res = await raw('/inside.txt', {}, method);
      expect(res.status).toBe(404);
      expect(res.body).toBe('next');
    },
  );

  it('answers the same file identically twice', async () => {
    const a = await raw('/inside.txt');
    const b = await raw('/inside.txt');
    expect(b.headers['etag']).toBe(a.headers['etag']);
    expect(b.headers['cache-control']).toBe(a.headers['cache-control']);
  });

  it('changes the ETag when the content changes', async () => {
    const before = await raw('/inside.txt');
    writeFileSync(join(root, 'site', 'inside.txt'), 'changed content!');
    const after = await raw('/inside.txt');
    expect(after.headers['etag']).not.toBe(before.headers['etag']);
    expect(after.body).toBe('changed content!');
  });
});
