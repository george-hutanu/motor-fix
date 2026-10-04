import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideApiConfiguration } from '@motor-fix/data-access';

import { SITE_ORIGIN } from './addresses';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { apiInternalUrl } from '../api-url';

const publicUrl = process.env['PUBLIC_WEB_URL'];

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideApiConfiguration(apiInternalUrl()),
    ...(publicUrl
      ? [{ provide: SITE_ORIGIN, useValue: new URL(publicUrl).origin }]
      : []),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
