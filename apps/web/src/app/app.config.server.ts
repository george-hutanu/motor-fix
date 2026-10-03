import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideApiConfiguration } from '@motor-fix/data-access';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { apiInternalUrl } from '../api-url';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideApiConfiguration(apiInternalUrl()),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
