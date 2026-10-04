import { LANGUAGES } from '@motor-fix/i18n';
import type { Express, Request } from 'express';

import { alternates, PUBLIC_PATHS } from '../app/addresses';

const ENTITIES = {
  "'": '&apos;',
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};
const xml = (text: string) =>
  text.replace(/["&'<>]/g, (c) => ENTITIES[c as keyof typeof ENTITIES]);

// The request's own address is the fallback for the dev server only: the
// deployed server requires PUBLIC_WEB_URL.
export function mountSearch(app: Express, publicOrigin: string | undefined) {
  const origin = (req: Request) =>
    publicOrigin ?? `${req.protocol}://${req.get('host')}`;

  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(sitemap(origin(req)));
  });

  app.get('/robots.txt', (req, res) => {
    res
      .type('text/plain')
      .send(`User-agent: *\nAllow: /\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
  });

  // Dashboards render in the browser; the server's answer is the only place a
  // crawler reads that they are not to be indexed.
  app.use('/app/', (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    next();
  });
}

function sitemap(origin: string) {
  const urls = PUBLIC_PATHS.flatMap((path) => {
    const links = alternates(origin, path);
    const others = Object.entries(links)
      .map(
        ([hreflang, href]) =>
          `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${xml(href)}"/>`,
      )
      .join('');
    return LANGUAGES.map(
      (language) => `<url><loc>${xml(links[language])}</loc>${others}</url>`,
    );
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>\n`;
}
