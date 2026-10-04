import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideCockpitTheme } from '@motor-fix/ui-cockpit';

import { primeuiLicense } from '../primeui-license';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(),
    provideHttpClient(withFetch()),
    provideCockpitTheme({ license: primeuiLicense }),
  ],
};
