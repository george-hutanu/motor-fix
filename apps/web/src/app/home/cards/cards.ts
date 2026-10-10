import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BrandDto, HomeGarageDto } from '@motor-fix/data-access';
import {
  formatKm,
  formatLei,
  formatRating,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Lamp, RatingDial } from '@motor-fix/ui-cockpit';

// Where the main button of Home goes, so the section's link goes there too.
export interface ResultsRoute {
  commands: string[];
  queryParams: Record<string, string>;
}

const NAMES_SHOWN = 6;

// The preview's garages again, one card each, under Home's car section.
@Component({
  imports: [Lamp, RatingDial, RouterLink, TranslatePipe],
  selector: 'mf-home-cards',
  styleUrl: './cards.css',
  templateUrl: './cards.html',
})
export class HomeCards {
  protected readonly i18n = inject(I18n);

  readonly brand = input.required<BrandDto>();
  readonly garages = input.required<HomeGarageDto[]>();
  readonly loading = input(false);
  readonly failed = input(false);
  readonly results = input.required<ResultsRoute>();
  readonly retry = output();

  protected readonly skeletons = [0, 1, 2];

  protected stance(garage: HomeGarageDto) {
    return this.i18n.t(
      garage.stance === 'works_on'
        ? 'public.home.preview.worksOn'
        : 'public.home.preview.doesNotTake',
      { brand: this.brand().name },
    );
  }

  protected rating(garage: HomeGarageDto) {
    return garage.rating === null
      ? this.i18n.t('public.home.preview.noReviews')
      : formatRating(garage.rating, this.i18n.language());
  }

  protected name(garage: HomeGarageDto) {
    return [garage.name, this.stance(garage), this.rating(garage)].join(', ');
  }

  protected where(garage: HomeGarageDto) {
    if (garage.businessKind === 'mobile') {
      const mobile = this.i18n.t('public.home.dial.mobile');
      return garage.serviceRadiusKm === undefined
        ? mobile
        : `${mobile} · ${this.i18n.t('public.home.cards.area', { km: garage.serviceRadiusKm })}`;
    }
    const parts = [garage.city];
    if (typeof garage.distanceKm === 'number') {
      parts.push(formatKm(garage.distanceKm, this.i18n.language()));
    }
    return parts.filter(Boolean).join(' · ') || null;
  }

  protected names(list: string[]) {
    if (list.length === 0) return this.i18n.t('public.home.cards.none');
    const shown = list.slice(0, NAMES_SHOWN).join(', ');
    const left = list.length - NAMES_SHOWN;
    return left > 0
      ? `${shown} ${this.i18n.t('public.home.cards.more', { n: left })}`
      : shown;
  }

  protected rate(lei: number) {
    return this.i18n.t('public.home.preview.rate', {
      rate: formatLei(lei * 100, this.i18n.language()),
    });
  }

  protected reviews(garage: HomeGarageDto) {
    return garage.reviewCount === 0
      ? this.i18n.t('public.home.preview.noReviews')
      : this.i18n.t('public.garageProfile.reviews', {
          count: garage.reviewCount,
        });
  }
}
