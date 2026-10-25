import { effect, type Injector } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
  ErrorsInstrumentation,
  EVENT_VIEW_CHANGED,
  faro,
  InternalLoggerLevel,
  initializeFaro,
  WebVitalsInstrumentation,
} from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

import { createBeforeSend, viewportClass } from './before-send/before-send';
import { sendMeasurementsTo } from './measure/measure';
import { sessionSync } from './session/session';
import { Consent } from '../../consent/consent';
import { routeTemplate } from '../route-template/route-template';

// Browser errors, Web Vitals and same-origin traces to the collector, named
// by the route template, with no user. Only under analytics consent: one
// session id per tab and a journey event per change of route template;
// without it no session id and nothing stored on the device. The trace
// header goes to this origin's API only. Telemetry never breaks the page, so
// any failure is dropped.
export function startFaro({
  environment,
  injector,
  url,
  version,
}: {
  environment: string;
  injector: Injector;
  url: string;
  version: string;
}): void {
  try {
    const router = injector.get(Router);
    const consent = injector.get(Consent);
    // Ties the uploaded source maps to this release.
    (globalThis as Record<string, unknown>)['__faroBundleId_web'] = version;
    initializeFaro({
      app: { environment, name: 'web', version },
      beforeSend: createBeforeSend(
        viewportClass(window.innerWidth),
        consent.granted,
      ),
      instrumentations: [
        new ErrorsInstrumentation(),
        new WebVitalsInstrumentation(),
        new TracingInstrumentation({
          instrumentationOptions: { propagateTraceHeaderCorsUrls: [] },
        }),
      ],
      internalLoggerLevel: InternalLoggerLevel.OFF,
      // The SDK's own sessions store theirs before any consent.
      sessionTracking: { enabled: false },
      trackGeolocation: false,
      url,
    });
    faro.api.setSession({ attributes: { isSampled: 'true' } });
    const sync = sessionSync(faro.api);
    // Before the first item leaves, so it already carries the session.
    sync(consent.granted());
    sendMeasurementsTo((type, values, context) =>
      faro.api.pushMeasurement({ type, values }, { context }),
    );

    let last: string | undefined;
    const name = () => routeTemplate(router.routerState.snapshot.root);
    const journey = () => {
      const toView = name();
      if (!consent.granted() || toView === last) return;
      faro.api.pushEvent(
        EVENT_VIEW_CHANGED,
        { fromView: last ?? '', toView },
        undefined,
        { skipDedupe: true },
      );
      last = toView;
    };
    faro.api.setView({ name: name() });
    router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      faro.api.setView({ name: name() });
      journey();
    });
    effect(
      () => {
        const on = consent.granted();
        sync(on);
        // A new grant reports the page shown as the journey's first step.
        last = undefined;
        if (on) journey();
      },
      { injector },
    );
  } catch {
    // Telemetry is optional.
  }
}
