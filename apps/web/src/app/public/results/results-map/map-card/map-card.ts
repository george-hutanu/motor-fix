import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  BrandRefDto,
  GaragePinDto,
  ListedGarageDto,
} from '@motor-fix/data-access';
import { formatLei, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp, RatingDial } from '@motor-fix/ui-cockpit';

// A tapped pin whose garage the list does not show: what the pin knows at
// once, then the garage's name, rating and way to its page once read.
@Component({
  imports: [Lamp, RatingDial, RouterLink, TranslatePipe],
  selector: 'mf-map-card',
  styleUrl: './map-card.css',
  templateUrl: './map-card.html',
})
export class MapCard {
  protected readonly i18n = inject(I18n);

  readonly pin = input.required<GaragePinDto>();
  readonly brand = input.required<BrandRefDto>();
  readonly garage = input<ListedGarageDto>();

  protected readonly takes = computed(() => this.pin().stance === 'works_on');

  protected readonly stance = computed(() =>
    this.i18n.t(
      this.takes()
        ? 'public.results.card.worksOn'
        : 'public.results.card.doesNotTake',
      { brand: this.brand().name },
    ),
  );

  protected readonly rate = computed(() => {
    const lei = this.pin().rateLei;
    return lei === null
      ? null
      : this.i18n.t('public.results.card.rate', {
          rate: formatLei(lei * 100, this.i18n.language()),
        });
  });

  protected readonly reviews = computed(() => {
    const count = this.garage()?.reviewCount ?? 0;
    return count === 0
      ? this.i18n.t('public.home.preview.noReviews')
      : this.i18n.t('public.garageProfile.reviews', { count });
  });
}
