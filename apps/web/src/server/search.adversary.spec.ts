/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { mountSearch } from './search';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, () =>
      resolve(`http://localhost:${(server.address() as AddressInfo).port}`),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

async function serve(publicUrl: string | undefined) {
  const app = express();
  mountSearch(app, publicUrl ? new URL(publicUrl).origin : undefined);
  app.use((_req, res) => {
    res.send('page');
  });
  const server = createServer(app);
  return { base: await listen(server), server };
}

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

describe('search engine rules under hostile input', () => {
  let server: Server;
  let base: string;

  afterEach(() => close(server));

  describe('with a public address that has a path and a port', () => {
    beforeEach(async () => {
      ({ base, server } = await serve(
        'https://motorfix.ro:8443/some/path?x=1#y',
      ));
    });

    it('keeps only the origin in the sitemap', async () => {
      const xml = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(locs(xml)).toEqual([
        'https://motorfix.ro:8443/ro/',
        'https://motorfix.ro:8443/en/',
        'https://motorfix.ro:8443/ro/terms',
        'https://motorfix.ro:8443/en/terms',
        'https://motorfix.ro:8443/ro/privacy',
        'https://motorfix.ro:8443/en/privacy',
      ]);
    });

    it('keeps only the origin in the robots.txt sitemap line', async () => {
      const text = await (await fetch(`${base}/robots.txt`)).text();

      expect(text).toContain('Sitemap: https://motorfix.ro:8443/sitemap.xml');
      expect(text).not.toContain('/some/path');
    });
  });

  describe('with a public address', () => {
    beforeEach(async () => {
      ({ base, server } = await serve('https://motorfix.ro///'));
    });

    it('does not double the slash after the origin', async () => {
      const xml = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(xml).not.toMatch(/https:\/\/motorfix\.ro\/\//);
      expect(locs(xml)[0]).toBe('https://motorfix.ro/ro/');
    });

    it('lists no dashboard, cockpit or not-found address in the sitemap', async () => {
      const xml = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(xml).not.toContain('/app');
      expect(xml).not.toContain('cockpit');
      expect(locs(xml)).toHaveLength(6);
    });

    it('answers the sitemap with a query string', async () => {
      const answer = await fetch(`${base}/sitemap.xml?cache=1`);

      expect(answer.status).toBe(200);
      expect(locs(await answer.text())).toHaveLength(6);
    });

    it('answers a HEAD request for the sitemap without a body', async () => {
      const answer = await fetch(`${base}/sitemap.xml`, { method: 'HEAD' });

      expect(answer.status).toBe(200);
      expect(await answer.text()).toBe('');
    });

    it('does not tell crawlers to avoid anything in robots.txt', async () => {
      const text = await (await fetch(`${base}/robots.txt`)).text();

      expect(text).not.toMatch(/^Disallow:\s*\S/m);
    });

    it('does not mark the sitemap or robots.txt noindex', async () => {
      const sitemap = await fetch(`${base}/sitemap.xml`);
      const robots = await fetch(`${base}/robots.txt`);

      expect(sitemap.headers.get('x-robots-tag')).toBeNull();
      expect(robots.headers.get('x-robots-tag')).toBeNull();
    });

    it('marks a deep dashboard address and an unknown dashboard address noindex', async () => {
      for (const path of ['/app/driver/x/y', '/app/nope', '/app/driver?a=1']) {
        const answer = await fetch(`${base}${path}`);
        expect(answer.headers.get('x-robots-tag')).toBe('noindex');
      }
    });

    it('marks the dashboard root noindex', async () => {
      const answer = await fetch(`${base}/app`);

      expect(answer.headers.get('x-robots-tag')).toBe('noindex');
    });

    it('marks a dashboard address noindex on every method', async () => {
      const answer = await fetch(`${base}/app/admin`, { method: 'POST' });

      expect(answer.headers.get('x-robots-tag')).toBe('noindex');
    });

    it('leaves lookalike prefixes indexable', async () => {
      for (const path of ['/application', '/apple/driver', '/en/app/x']) {
        const answer = await fetch(`${base}${path}`);
        expect(answer.headers.get('x-robots-tag')).toBeNull();
      }
    });

    it('leaves Home and the language roots without a robots header', async () => {
      for (const path of ['/', '/ro', '/en/', '/de/']) {
        const answer = await fetch(`${base}${path}`);
        expect(answer.headers.get('x-robots-tag')).toBeNull();
      }
    });

    it('gives the same sitemap twice', async () => {
      const first = await (await fetch(`${base}/sitemap.xml`)).text();
      const second = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(second).toBe(first);
    });
  });

  describe('without a public address', () => {
    beforeEach(async () => {
      ({ base, server } = await serve(undefined));
    });

    it('uses the request origin in robots.txt', async () => {
      const text = await (await fetch(`${base}/robots.txt`)).text();

      expect(text).toContain(`Sitemap: ${base}/sitemap.xml`);
    });

    it('uses the request origin for every alternate', async () => {
      const xml = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(xml.split(`href="${base}/ro/"`)).toHaveLength(5);
      expect(xml.split(`href="${base}/en/"`)).toHaveLength(3);
    });
  });

  describe('with an empty public address', () => {
    beforeEach(async () => {
      ({ base, server } = await serve(''));
    });

    it('falls back to the request origin', async () => {
      const xml = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(locs(xml)).toEqual(
        [
          '/ro/',
          '/en/',
          '/ro/terms',
          '/en/terms',
          '/ro/privacy',
          '/en/privacy',
        ].map((path) => `${base}${path}`),
      );
    });
  });
});
