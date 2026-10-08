import { NavigationEnd, type Router } from '@angular/router';
import {
  ErrorsInstrumentation,
  faro,
  InternalLoggerLevel,
  initializeFaro,
  WebVitalsInstrumentation,
} from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

import { createBeforeSend, viewportClass } from './before-send/before-send';
import { routeTemplate } from '../route-template/route-template';

// Browser errors, Web Vitals and same-origin traces to the collector, named
// by the route template. No session id, no user, nothing stored on the
// device; the trace header goes to this origin's API only. Telemetry never
// breaks the page, so any failure is dropped.
export function startFaro({
  environment,
  router,
  url,
  version,
}: {
  environment: string;
  router: Router;
  url: string;
  version: string;
}): void {
  try {
    // Ties the uploaded source maps to this release.
    (globalThis as Record<string, unknown>)['__faroBundleId_web'] = version;
    initializeFaro({
      app: { environment, name: 'web', version },
      beforeSend: createBeforeSend(viewportClass(window.innerWidth)),
      instrumentations: [
        new ErrorsInstrumentation(),
        new WebVitalsInstrumentation(),
        new TracingInstrumentation({
          instrumentationOptions: { propagateTraceHeaderCorsUrls: [] },
        }),
      ],
      internalLoggerLevel: InternalLoggerLevel.OFF,
      sessionTracking: { enabled: false },
      trackGeolocation: false,
      url,
    });
    faro.api.setSession({ attributes: { isSampled: 'true' } });
    const view = () =>
      faro.api.setView({
        name: routeTemplate(router.routerState.snapshot.root),
      });
    view();
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) view();
    });
  } catch {
    // Telemetry is optional.
  }
}
