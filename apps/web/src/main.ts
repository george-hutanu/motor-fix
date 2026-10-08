import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { loadTelemetry } from './app/telemetry/browser/load/load';

bootstrapApplication(App, appConfig)
  .then((app) => loadTelemetry(app.injector.get(Router)))
  .catch((err) => console.error(err));
