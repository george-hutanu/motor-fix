import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { type Facility, PAYMENTS } from '@motor-fix/contracts/garage-hours';
import { FUELS } from '@motor-fix/contracts/plate';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { formatLei, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

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
        fuels: FUELS.filter((fuel) => brand.fuels.includes(fuel))
          .map((fuel) => t(`public.requestQuote.fuelWord.${fuel}`))
          .join(' · '),
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
    return facilities.map((key) => {
      const label = this.i18n.t(`public.listing.hours.facility.${key}`);
      if (key !== 'courtesy_car' || !courtesyCar) return { key, label };
      if (!courtesyCar.paid)
        return {
          key,
          label: `${label} · ${this.i18n.t('public.garageProfile.details.free')}`,
        };
      if (courtesyCar.pricePerDayBani === undefined) return { key, label };
      return {
        key,
        label: `${label} · ${this.i18n.t(
          'public.garageProfile.details.perDay',
          {
            price: formatLei(courtesyCar.pricePerDayBani, language),
          },
        )}`,
      };
    });
  });
  protected readonly payment = computed(() => {
    const methods = PAYMENTS.filter(
      (method) => this.garage().paymentMethods[method],
    ).map((method) =>
      this.i18n.t(`public.garageProfile.details.payments.${method}`),
    );
    return methods.length
      ? this.i18n.t('public.garageProfile.details.payment', {
          methods: methods.join(', '),
        })
      : '';
  });
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
