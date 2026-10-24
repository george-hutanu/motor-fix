import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { Facility } from '@motor-fix/contracts/garage-hours';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

import { carTerms, fuelLine, paymentLine } from './detail-lines';

// The brand in context leads the list that holds it; the rest keep the
// answer's order.
const leading = <T extends { id: string }>(list: T[], id: string | undefined) =>
  [...list].sort((a, b) => Number(b.id === id) - Number(a.id === id));

// An outline icon for each facility the listing offers.
const ICONS: Record<Facility, string> = {
  courtesy_car:
    'M5 17v-5l2-5h10l2 5v5M5 17h14M5 17v2m14-2v2M5 12h14M8 14.5h.01M16 14.5h.01',
  pickup_dropoff:
    'M2 16V6h11v10M13 9h4l4 4v3h-8M2 16h2m5 0h4m4 0h4M6.5 18a1.5 1.5 0 1 0 0-.01M17.5 18a1.5 1.5 0 1 0 0-.01',
  waiting_area: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 7v5l3 2',
};

// The brands the garage takes and refuses, with the fuels it takes each in,
// then its facilities, the courtesy car's terms and how it is paid. With
// none of these the section shows nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.hidden]': 'empty() ? "" : null' },
  imports: [Lamp, TranslatePipe],
  selector: 'section[mf-details-section]',
  styleUrl: './details-section.css',
  templateUrl: './details-section.html',
})
export class DetailsSection {
  readonly garage = input.required<PublicGarageDto>();

  private readonly i18n = inject(I18n);

  protected readonly icons = ICONS;

  protected readonly worksOn = computed(() => {
    const t = (key: string) => this.i18n.t(key);
    return leading(this.garage().worksOn, this.garage().brand?.id).map(
      (brand) => ({
        ...brand,
        fuels: fuelLine(brand.fuels, t),
      }),
    );
  });
  protected readonly doesNotTake = computed(() =>
    leading(this.garage().doesNotTake, this.garage().brand?.id),
  );
  protected readonly brandNote = computed(() =>
    this.worksOn().length || this.doesNotTake().length
      ? (this.garage().brandNote ?? '')
      : '',
  );
  protected readonly facilities = computed(() => {
    const { courtesyCar, facilities } = this.garage();
    const language = this.i18n.language();
    const t = (key: string, params?: Record<string, string>) =>
      this.i18n.t(key, params);
    return facilities.map((key) => {
      const label = t(`public.listing.hours.facility.${key}`);
      const terms =
        key === 'courtesy_car' ? carTerms(courtesyCar, language, t) : '';
      return { key, label: terms ? `${label} · ${terms}` : label };
    });
  });
  protected readonly payment = computed(() =>
    paymentLine(this.garage().paymentMethods, (key, params) =>
      this.i18n.t(key, params),
    ),
  );
  protected readonly facilitiesNote = computed(
    () => this.garage().facilitiesNote ?? '',
  );
  protected readonly hasFacilities = computed(
    () =>
      this.facilities().length > 0 ||
      this.payment() !== '' ||
      this.facilitiesNote() !== '',
  );
  protected readonly empty = computed(
    () =>
      !this.worksOn().length &&
      !this.doesNotTake().length &&
      !this.hasFacilities(),
  );
}
