import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideCockpitTheme } from '@motor-fix/ui-cockpit';

import { routes } from './app.routes';
import { primeuiLicense } from '../primeui-license';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideCockpitTheme({ license: primeuiLicense }),
  ],
};
