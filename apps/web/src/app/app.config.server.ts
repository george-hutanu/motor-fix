import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { publicWebUrl } from '@motor-fix/contracts/env';
import { provideApiConfiguration } from '@motor-fix/data-access';

import { SITE_ORIGIN } from './addresses';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { apiInternalUrl } from '../api-url';

const publicUrl = publicWebUrl();

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideApiConfiguration(apiInternalUrl()),
    ...(publicUrl
      ? [{ provide: SITE_ORIGIN, useValue: publicUrl.origin }]
      : []),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
