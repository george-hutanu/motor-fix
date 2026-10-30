import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { formatKm, I18n, TranslatePipe } from '@motor-fix/i18n';

import { directionsHref, type Platform, platformOf } from './directions';
import { GarageMap } from './garage-map/garage-map';
import { hoursLines } from './hours-lines';
import { Consent } from '../../../consent/consent';

// Where the garage is and when it is open. A mobile mechanic is shown by the
// area it comes to, never by an address, and on a map of that area when the
// answer carries its rounded centre; with neither a place nor hours the
// section shows nothing. A workshop with a point also gets a small map of it
// and directions in the maps app of the driver's device.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.hidden]': 'empty() ? "" : null' },
  imports: [GarageMap, TranslatePipe],
  selector: 'section[mf-where-section]',
  styleUrl: './where-section.css',
  templateUrl: './where-section.html',
})
export class WhereSection {
  readonly garage = input.required<PublicGarageDto>();

  private readonly i18n = inject(I18n);
  private readonly consent = inject(Consent);
  // The server, and a browser before it runs, gives a computer's directions.
  protected readonly platform = signal<Platform>('computer');

  protected readonly mobile = computed(
    () => this.garage().businessKind === 'mobile',
  );
  protected readonly address = computed(() =>
    this.mobile() ? '' : (this.garage().address ?? ''),
  );
  protected readonly area = computed(() =>
    this.mobile()
      ? this.i18n.t('public.garageProfile.where.mobile', {
          km: formatKm(
            this.garage().serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
            this.i18n.language(),
          ),
        })
      : '',
  );
  protected readonly lines = computed(() =>
    hoursLines(this.garage().hours, this.i18n.language(), (key) =>
      this.i18n.t(key),
    ),
  );
  // A workshop's point, as the answer carries it.
  protected readonly point = computed(() => {
    const { latitude: lat, longitude: lng } = this.garage();
    if (this.mobile() || typeof lat !== 'number' || typeof lng !== 'number')
      return undefined;
    return { lat, lng };
  });
  // A mobile mechanic's area: its rounded centre and the radius it travels.
  protected readonly circle = computed(() => {
    const { areaLat: lat, areaLng: lng, serviceRadiusKm } = this.garage();
    if (!this.mobile() || typeof lat !== 'number' || typeof lng !== 'number')
      return undefined;
    return {
      at: { lat, lng },
      km: serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
    };
  });
  // The map went (its image or the interactive map failed); a new garage
  // tries again.
  protected readonly mapGone = linkedSignal({
    computation: () => false,
    source: this.garage,
  });
  protected readonly href = computed(() => {
    const point = this.point();
    return point && directionsHref(this.platform(), point.lat, point.lng);
  });
  // Only the computer's directions open in a new tab.
  protected readonly computer = computed(() => this.platform() === 'computer');
  // A point alone still gives the map and the directions.
  protected readonly empty = computed(
    () =>
      !this.address() &&
      !this.area() &&
      this.lines().length === 0 &&
      !this.point(),
  );

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => this.platform.set(platformOf(navigator.userAgent)));
  }

  protected track() {
    this.consent.track('directions_opened', { platform: this.platform() });
  }
}
