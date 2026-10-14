import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BrandRefDto, ListedGarageDto } from '@motor-fix/data-access';
import {
  formatKm,
  formatLei,
  formatRating,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Lamp, RatingDial } from '@motor-fix/ui-cockpit';

// Whole keys, so the workspace check finds each one.
const FACILITIES: Record<ListedGarageDto['facilities'][number], string> = {
  courtesy_car: 'public.listing.hours.facility.courtesy_car',
  pickup_dropoff: 'public.listing.hours.facility.pickup_dropoff',
  waiting_area: 'public.listing.hours.facility.waiting_area',
};

// One garage of the results: who it is, where, whether it takes the brand,
// what it costs and how it is rated, and the way to its page.
@Component({
  imports: [Lamp, RatingDial, RouterLink, TranslatePipe],
  selector: 'mf-result-card',
  styleUrl: './result-card.css',
  templateUrl: './result-card.html',
})
export class ResultCard {
  protected readonly i18n = inject(I18n);

  readonly brand = input.required<BrandRefDto>();
  readonly garage = input.required<ListedGarageDto>();

  protected readonly initials = computed(() =>
    this.garage()
      .name.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toLocaleUpperCase('ro'))
      .join(''),
  );

  protected readonly takes = computed(
    () => this.garage().stance === 'works_on',
  );

  protected readonly stance = computed(() =>
    this.i18n.t(
      this.takes()
        ? 'public.results.card.worksOn'
        : 'public.results.card.doesNotTake',
      { brand: this.brand().name },
    ),
  );

  // The city stays as written in either language; a mobile mechanic has none
  // and says its area instead.
  protected readonly where = computed(() => {
    const garage = this.garage();
    if (garage.businessKind === 'mobile') {
      const km = garage.serviceRadiusKm;
      return {
        city: '',
        rest:
          km === undefined
            ? this.i18n.t('public.home.dial.mobile')
            : this.i18n.t('public.results.card.mobile', { km }),
      };
    }
    const city = garage.city ?? '';
    const km =
      typeof garage.distanceKm === 'number'
        ? formatKm(garage.distanceKm, this.i18n.language())
        : '';
    return { city, rest: city && km ? ` · ${km}` : km };
  });

  protected readonly rated = computed(() => {
    const rating = this.garage().rating;
    return rating === null
      ? null
      : this.i18n.t('shell.gauge.rating', {
          value: formatRating(rating, this.i18n.language()),
        });
  });

  protected readonly rate = computed(() => {
    const lei = this.garage().labourFromLei;
    return lei === null
      ? null
      : this.i18n.t('public.results.card.rate', {
          rate: formatLei(lei * 100, this.i18n.language()),
        });
  });

  protected readonly reviews = computed(() => {
    const count = this.garage().reviewCount;
    return count === 0
      ? this.i18n.t('public.home.preview.noReviews')
      : this.i18n.t('public.garageProfile.reviews', { count });
  });

  protected facilityName(kind: ListedGarageDto['facilities'][number]) {
    return this.i18n.t(FACILITIES[kind]);
  }

  protected names(brands: BrandRefDto[]) {
    return brands.length === 0
      ? this.i18n.t('public.home.cards.none')
      : brands.map((brand) => brand.name).join(', ');
  }
}
