import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BrandDto, HomeGarageDto } from '@motor-fix/data-access';
import { formatLei, formatRating, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

// Three rows under Home's dial: the two best garages that take the brand,
// then the best one that does not. Each row opens the garage's profile.
@Component({
  imports: [Lamp, RouterLink, TranslatePipe],
  selector: 'mf-home-preview',
  styleUrl: './preview.css',
  templateUrl: './preview.html',
})
export class HomePreview {
  protected readonly i18n = inject(I18n);

  readonly brand = input.required<BrandDto>();
  readonly garages = input.required<HomeGarageDto[]>();
  readonly loading = input(false);

  protected readonly skeletons = [0, 1, 2];

  protected rating(garage: HomeGarageDto) {
    return garage.rating === null
      ? this.i18n.t('public.home.preview.noReviews')
      : formatRating(garage.rating, this.i18n.language());
  }

  protected rate(lei: number) {
    return formatLei(lei * 100, this.i18n.language());
  }
}
