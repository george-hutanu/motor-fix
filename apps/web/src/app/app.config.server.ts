import { HTTP_TRANSFER_CACHE_ORIGIN_MAP } from '@angular/common/http';
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

// The API's private origin, the key the browser's origin replaces.
const apiOrigin = () => {
  const url = apiInternalUrl();
  if (!URL.canParse(url))
    throw new Error('API_INTERNAL_URL must be an absolute URL');
  return new URL(url).origin;
};

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
      ? [
          { provide: SITE_ORIGIN, useValue: publicUrl.origin },
          // Each read handed to the browser is keyed by the address the
          // browser will ask, not the API's private one.
          {
            provide: HTTP_TRANSFER_CACHE_ORIGIN_MAP,
            useValue: { [apiOrigin()]: publicUrl.origin },
          },
        ]
      : []),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
