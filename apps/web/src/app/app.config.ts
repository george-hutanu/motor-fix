import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideI18n, provideRememberedLanguage } from '@motor-fix/i18n';
import { provideCockpitTheme } from '@motor-fix/ui-cockpit';

import { provideLanguageAddresses } from './addresses';
import { routes } from './app.routes';
import { authInterceptor } from './auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideRouter(routes),
    provideI18n(),
    provideCockpitTheme(),
    provideRememberedLanguage(),
    provideLanguageAddresses(),
    // Only the production build emits ngsw-worker.js.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() }),
  ],
};
