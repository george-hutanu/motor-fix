// Telemetry starts before anything else loads, so HTTP is patched first.
import './server/telemetry/telemetry';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { faroUrl, publicWebUrl, readEnv } from '@motor-fix/contracts/env';
import { setRoute } from '@motor-fix/observability';
import express from 'express';

import { apiInternalUrl } from './api-url';
import { mountCompression } from './server/compress/compress';
import { mountEdge } from './server/edge';
import { renderError } from './server/render-error/render-error';
import { mountSearch } from './server/search';
import { withTelemetryMeta } from './server/telemetry-meta/telemetry-meta';

const browserDistFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../browser',
);

const app = express();
const publicUrl = publicWebUrl();
const faro = faroUrl();
// Read raw, not through readEnv: the build and the dev server import this
// file without the runtime environment readEnv requires (see below).
const collector = faro
  ? { url: faro, version: process.env['RELEASE_SHA'] || 'dev' }
  : undefined;
const angularApp = new AngularNodeAppEngine({
  allowedHosts: publicUrl ? [publicUrl.hostname] : undefined,
});

mountEdge(app, apiInternalUrl());
mountCompression(app);
mountSearch(app, publicUrl?.origin);

app.use(
  express.static(browserDistFolder, {
    index: false,
    maxAge: '1y',
    redirect: false,
  }),
);

app.use((req, res, next) => {
  // A page rendered on the server names itself on navigation; one left to
  // the browser keeps this name.
  setRoute('client-rendered');
  angularApp
    .handle(req)
    .then((response) => response && withTelemetryMeta(response, collector))
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});
app.use(renderError);

if (isMainModule(import.meta.url)) {
  readEnv(['API_INTERNAL_URL', 'PUBLIC_WEB_URL']);
  app.listen(Number(process.env['PORT'] ?? 4000));
}

// Used by the Angular CLI dev server and at build time.
export const reqHandler = createNodeRequestHandler(app);
