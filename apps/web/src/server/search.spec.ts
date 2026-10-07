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

describe('search engine rules', () => {
  let server: Server;
  let base: string;

  afterEach(() => close(server));

  describe('with PUBLIC_WEB_URL', () => {
    beforeEach(async () => {
      ({ base, server } = await serve('https://motorfix.ro/'));
    });

    it('lists both language addresses of every public page in the sitemap, with their alternates', async () => {
      const answer = await fetch(`${base}/sitemap.xml`);
      const xml = await answer.text();

      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toContain('xml');
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
      expect(xml).toContain(
        'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      );
      expect(
        [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]),
      ).toEqual([
        'https://motorfix.ro/ro/',
        'https://motorfix.ro/en/',
        'https://motorfix.ro/ro/terms',
        'https://motorfix.ro/en/terms',
        'https://motorfix.ro/ro/privacy',
        'https://motorfix.ro/en/privacy',
        'https://motorfix.ro/ro/list-your-garage',
        'https://motorfix.ro/en/list-your-garage',
      ]);
      for (const [hreflang, href] of [
        ['ro', 'https://motorfix.ro/ro/'],
        ['en', 'https://motorfix.ro/en/'],
        ['x-default', 'https://motorfix.ro/ro/'],
      ]) {
        const link = `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`;
        expect(xml.split(link)).toHaveLength(3);
      }
    });

    it('allows crawling and names the sitemap in robots.txt', async () => {
      const answer = await fetch(`${base}/robots.txt`);
      const text = await answer.text();

      expect(answer.headers.get('content-type')).toContain('text/plain');
      expect(text).toContain('User-agent: *');
      expect(text).toContain('Allow: /');
      expect(text).toContain('Sitemap: https://motorfix.ro/sitemap.xml');
    });

    it('tells search engines not to index the dashboards', async () => {
      const answer = await fetch(`${base}/app/driver`);

      expect(answer.headers.get('x-robots-tag')).toBe('noindex');
      expect(await answer.text()).toBe('page');
    });

    it('leaves the public pages indexable', async () => {
      const answer = await fetch(`${base}/ro/`);

      expect(answer.headers.get('x-robots-tag')).toBeNull();
    });
  });

  describe('without PUBLIC_WEB_URL', () => {
    beforeEach(async () => {
      ({ base, server } = await serve(undefined));
    });

    it('uses the address the request came to', async () => {
      const xml = await (await fetch(`${base}/sitemap.xml`)).text();

      expect(xml).toContain(`<loc>${base}/en/</loc>`);
    });
  });
});
