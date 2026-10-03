import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { readEnv } from '@motor-fix/contracts/env';
import express from 'express';

import { apiInternalUrl } from './api-url';
import { mountEdge } from './server/edge';

const browserDistFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../browser',
);

const app = express();
const publicUrl = process.env['PUBLIC_WEB_URL'];
const angularApp = new AngularNodeAppEngine({
  allowedHosts: publicUrl ? [new URL(publicUrl).hostname] : [],
});

mountEdge(app, apiInternalUrl());

app.use(
  express.static(browserDistFolder, {
    index: false,
    maxAge: '1y',
    redirect: false,
  }),
);

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  readEnv(['API_INTERNAL_URL', 'PUBLIC_WEB_URL']);
  app.listen(Number(process.env['PORT'] ?? 4000));
}

// Used by the Angular CLI dev server and at build time.
export const reqHandler = createNodeRequestHandler(app);
