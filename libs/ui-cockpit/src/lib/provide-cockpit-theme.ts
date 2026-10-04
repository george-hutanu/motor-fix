import { EnvironmentProviders } from '@angular/core';
import { providePrimeNG } from 'primeng/config';

import { CockpitPreset } from './preset';

export function provideCockpitTheme(
  options: { license?: string } = {},
): EnvironmentProviders {
  return providePrimeNG({
    theme: { options: { darkModeSelector: 'system' }, preset: CockpitPreset },
    ...(options.license ? { license: options.license } : {}),
  });
}
