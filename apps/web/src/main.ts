import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { provideApiConfiguration } from '@motor-fix/data-access';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { loadTelemetry } from './app/telemetry/browser/load/load';

// The API at the page's own origin, written out in full: the server render
// keys each read it hands over by its absolute address (app.config.server.ts).
const browserConfig = mergeApplicationConfig(appConfig, {
  providers: [provideApiConfiguration(location.origin)],
});

bootstrapApplication(App, browserConfig)
  .then((app) => loadTelemetry(app.injector.get(Router)))
  .catch((err) => console.error(err));
