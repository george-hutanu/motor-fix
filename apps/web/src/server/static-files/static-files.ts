import express, { type Express } from 'express';

// A source map, whatever its case or query: the build writes hidden ones for
// the release to upload, and they never leave the server.
const SOURCE_MAP = /\.map$/i;

// The build names a file it fingerprints `<name>-<8 base32 characters>.<ext>`
// (outputHashing "all"): new content always gets a new name.
const HASHED = /-[A-Z0-9]{8}\.[^./]+$/;

// A hashed file is kept for a year. Every other file (the service worker, its
// manifest, the icons) is revalidated on each use, so a deploy reaches a
// returning visitor; the ETag turns an unchanged one into a 304. A source map
// is answered 404 here, before the page renderer can claim it.
export function mountStaticFiles(app: Express, folder: string) {
  const serve = express.static(folder, {
    index: false,
    redirect: false,
    setHeaders: (res, path) =>
      res.setHeader(
        'Cache-Control',
        HASHED.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
      ),
  });
  app.use((req, res, next) => {
    if (SOURCE_MAP.test(req.path)) res.status(404).end();
    else serve(req, res, next);
  });
}
