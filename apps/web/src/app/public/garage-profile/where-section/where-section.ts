import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { formatKm, I18n, TranslatePipe } from '@motor-fix/i18n';

import { hoursLines } from './hours-lines';

// Where the garage is and when it is open. A mobile mechanic is shown by the
// area it comes to, never by an address; with neither a place nor hours the
// section shows nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.hidden]': 'empty() ? "" : null' },
  imports: [TranslatePipe],
  selector: 'section[mf-where-section]',
  styleUrl: './where-section.css',
  templateUrl: './where-section.html',
})
export class WhereSection {
  readonly garage = input.required<PublicGarageDto>();

  private readonly i18n = inject(I18n);

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
  protected readonly lines = computed(() => {
    const closed = this.i18n.t('public.listing.hours.closed');
    return hoursLines(this.garage().hours, this.i18n.language(), (key) =>
      this.i18n.t(key),
    ).map((line) => ({ ...line, closed: line.times === closed }));
  });
  protected readonly empty = computed(
    () => !this.address() && !this.area() && this.lines().length === 0,
  );
}
