import { TestBed } from '@angular/core/testing';
import { PRIME_NG_CONFIG } from 'primeng/config';

import { CockpitPreset } from './preset';
import { provideCockpitTheme } from './provide-cockpit-theme';

function configWith(providers: ReturnType<typeof provideCockpitTheme>) {
  TestBed.configureTestingModule({ providers: [providers] });
  return TestBed.inject(PRIME_NG_CONFIG);
}

describe('provideCockpitTheme', () => {
  it('registers the Cockpit preset following the device colour scheme', () => {
    const config = configWith(provideCockpitTheme());

    expect(config.theme).toEqual({
      options: { darkModeSelector: 'system' },
      preset: CockpitPreset,
    });
    expect(config.license).toBeUndefined();
  });

  it('passes a licence key through when one is given', () => {
    const config = configWith(provideCockpitTheme({ license: 'key-123' }));

    expect(config.license).toBe('key-123');
  });
});
