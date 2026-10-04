import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';

import { provideCockpitTheme } from './provide-cockpit-theme';

describe('provideCockpitTheme', () => {
  it('keeps overlays out of the browser top layer so toasts stay above them', () => {
    TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });

    expect(TestBed.inject(OVERLAY_DEFAULT_CONFIG)).toEqual({
      usePopover: false,
    });
  });
});
