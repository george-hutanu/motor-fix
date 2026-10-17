import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
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

import { ProfilePrefetch } from '../../profile-prefetch/profile-prefetch';
import { SaveGarageButton } from '../../saved-garages/save-garage-button/save-garage-button';

const REST_MS = 100;

// Whole keys, so the workspace check finds each one.
const FACILITIES: Record<ListedGarageDto['facilities'][number], string> = {
  courtesy_car: 'public.listing.hours.facility.courtesy_car',
  pickup_dropoff: 'public.listing.hours.facility.pickup_dropoff',
  waiting_area: 'public.listing.hours.facility.waiting_area',
};

// One garage of the results: who it is, where, whether it takes the brand,
// what it costs and how it is rated, and the way to its page.
@Component({
  host: {
    '(click)': 'picked($event)',
    '(focusin)': 'point.emit(true)',
    '(focusout)': 'blurred($event)',
  },
  imports: [Lamp, RatingDial, RouterLink, SaveGarageButton, TranslatePipe],
  selector: 'mf-result-card',
  styleUrl: './result-card.css',
  templateUrl: './result-card.html',
})
export class ResultCard {
  protected readonly i18n = inject(I18n);

  readonly brand = input.required<BrandRefDto>();
  readonly garage = input.required<ListedGarageDto>();
  // Whether its garage is the selected one, drawn in the amber state.
  readonly selected = input(false);
  // A pointer (not a touch) or the focus resting on it, and leaving it.
  readonly point = output<boolean>();
  // A tap anywhere on it but its link and its bookmark.
  readonly pick = output<void>();

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    const prefetch = inject(ProfilePrefetch);
    const host = this.host;
    const destroyRef = inject(DestroyRef);
    const want = () => prefetch.want(this.garage().slug, this.brand().slug);
    // A pointer resting on the card, a touch on it, or the card scrolled into
    // view all say it is about to be opened. A touch also ends in a
    // pointerleave, which must not cancel what it started.
    afterNextRender(() => {
      let rest: ReturnType<typeof setTimeout> | undefined;
      const enter = (event: Event) => {
        if ((event as PointerEvent).pointerType === 'touch') return;
        this.point.emit(true);
        clearTimeout(rest);
        rest = setTimeout(want, REST_MS);
      };
      const leave = (event: Event) => {
        if ((event as PointerEvent).pointerType === 'touch') return;
        this.point.emit(false);
        clearTimeout(rest);
        prefetch.cancel(this.garage().slug, this.brand().slug);
      };
      host.addEventListener('pointerenter', enter);
      host.addEventListener('pointerleave', leave);
      host.addEventListener('touchstart', want, { passive: true });
      // The first delivery is where the card stood when drawn: on screen
      // then is not intent, only coming into view later is.
      let drawn = false;
      const seen =
        typeof IntersectionObserver === 'function'
          ? new IntersectionObserver((entries) => {
              if (drawn && entries.some((e) => e.isIntersecting)) want();
              drawn = true;
            })
          : undefined;
      seen?.observe(host);
      destroyRef.onDestroy(() => {
        clearTimeout(rest);
        seen?.disconnect();
        host.removeEventListener('pointerenter', enter);
        host.removeEventListener('pointerleave', leave);
        host.removeEventListener('touchstart', want);
      });
    });
  }

  // Brings the card into the list's view at its nearest edge; the focus
  // stays where it is.
  reveal(smooth: boolean) {
    this.host.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'nearest',
    });
  }

  protected picked(event: Event) {
    const target = event.target as Element | null;
    if (target?.closest('a, button, mf-save-garage-button')) return;
    this.pick.emit();
  }

  // Focus moving between the card's own controls keeps it pointed.
  protected blurred(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.contains(next)) return;
    this.point.emit(false);
  }

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
