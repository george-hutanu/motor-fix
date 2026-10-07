import compression from 'compression';
import type { Express } from 'express';

// Railway bills the bytes leaving the container, before its edge compresses
// them, so the server compresses its own answers. Mounted after the API relay,
// which streams events and must reach the browser as the API sent it.
export function mountCompression(app: Express) {
  app.use(compression());
}
