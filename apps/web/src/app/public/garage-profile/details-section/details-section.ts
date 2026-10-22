import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { FUELS } from '@motor-fix/contracts/plate';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { formatLei, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

const PAYMENTS = ['cash', 'card', 'transfer'] as const;

// The brand in context leads the list that holds it; the rest keep the
// answer's order.
const leading = <T extends { id: string }>(list: T[], id: string | undefined) =>
  [...list].sort((a, b) => Number(b.id === id) - Number(a.id === id));

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
    return facilities.map((facility) => {
      const label = this.i18n.t(`public.listing.hours.facility.${facility}`);
      if (facility !== 'courtesy_car' || !courtesyCar) return label;
      if (!courtesyCar.paid)
        return `${label} · ${this.i18n.t('public.garageProfile.details.free')}`;
      if (courtesyCar.pricePerDayBani === undefined) return label;
      return `${label} · ${this.i18n.t('public.garageProfile.details.perDay', {
        price: formatLei(courtesyCar.pricePerDayBani, language),
      })}`;
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
