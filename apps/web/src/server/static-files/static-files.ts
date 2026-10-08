import express, { type Express } from 'express';

// A source map, whatever its case or query: the build writes hidden ones for
// the release to upload, and they never leave the server (FR-015).
const SOURCE_MAP = /\.map$/i;

// The browser build's files, cached for a year (their names carry a hash).
// A source map is answered 404 here, before the page renderer can claim it.
export function mountStaticFiles(app: Express, folder: string) {
  const serve = express.static(folder, {
    index: false,
    maxAge: '1y',
    redirect: false,
  });
  app.use((req, res, next) => {
    if (SOURCE_MAP.test(req.path)) res.status(404).end();
    else serve(req, res, next);
  });
}
