import {
  ApplicationConfig,
  inject,
  mergeApplicationConfig,
  provideEnvironmentInitializer,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { publicWebUrl } from '@motor-fix/contracts/env';
import { provideApiConfiguration } from '@motor-fix/data-access';
import { setRoute } from '@motor-fix/observability';

import { SITE_ORIGIN } from './addresses';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { routeTemplate } from './telemetry/route-template/route-template';
import { apiInternalUrl } from '../api-url';

const publicUrl = publicWebUrl();

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideApiConfiguration(apiInternalUrl()),
    // Names the request span by the route the page matched.
    provideEnvironmentInitializer(() => {
      const router = inject(Router);
      router.events.subscribe((event) => {
        if (event instanceof NavigationEnd)
          setRoute(routeTemplate(router.routerState.snapshot.root));
      });
    }),
    ...(publicUrl
      ? [{ provide: SITE_ORIGIN, useValue: publicUrl.origin }]
      : []),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
