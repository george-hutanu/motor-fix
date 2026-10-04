import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideI18n } from '@motor-fix/i18n';
import { provideCockpitTheme } from '@motor-fix/ui-cockpit';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideI18n(),
    provideCockpitTheme(),
  ],
};
