import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import {
  type EnvironmentProviders,
  makeEnvironmentProviders,
} from '@angular/core';

// The colour scheme follows the device in cockpit.css alone. Overlays stay
// out of the browser top layer so the toaster is drawn above dialogs.
export function provideCockpitTheme(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
  ]);
}
