import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FACILITIES, PAYMENTS } from '@motor-fix/contracts/garage-hours';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { FUELS } from '@motor-fix/contracts/plate';
import { type GarageProfileDto, GaragesService } from '@motor-fix/data-access';
import {
  formatKm,
  formatLei,
  I18n,
  type Language,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton, Lamp } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { liveView } from '../../live/view';
import { hoursLines } from '../../public/garage-profile/where-section/hours-lines';
import { Live } from '../live';
import { garageOf, Session } from '../session';

const SUSPENDED = 410;

// "Profilul service-ului": the garage's public profile as drivers see it,
// read only, with the stored phone the public page never shows. The brands,
// fuels, facilities and hours are built as the public profile builds them,
// from the same labels, so the two read the same.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, Lamp, NgTemplateOutlet, TranslatePipe],
  selector: 'mf-profile-view',
  styleUrl: './profile-view.css',
  templateUrl: './profile-view.html',
})
export class ProfileView {
  private readonly api = inject(GaragesService);
  private readonly session = inject(Session);
  private readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  protected readonly skeletons = [1, 2, 3];
  private readonly garageId = computed(
    () => garageOf(this.session.shown())?.garageId ?? '',
  );
  // A suspended garage answers 410 on a first read and on a re-read alike;
  // liveView keeps a re-read's failure to itself, so the read says it here.
  protected readonly suspended = signal(false);
  protected readonly view = liveView(
    async () => {
      try {
        const answer = await this.api.garageProfileControllerRead({
          garageId: this.garageId(),
        });
        this.suspended.set(false);
        return answer;
      } catch (failure) {
        if (
          failure instanceof HttpErrorResponse &&
          failure.status === SUSPENDED
        ) {
          this.suspended.set(true);
        }
        throw failure;
      }
    },
    {
      changes: this.live
        .on(['garage.updated', 'facility.removed', 'facility.re_add_decided'])
        .pipe(filter((m) => m.id === this.garageId())),
      goneOn: [403, 404],
      resync: this.live.resync,
      retryAfter: 60_000,
    },
  );
  protected readonly profile = computed(() =>
    this.suspended() ? undefined : this.view.value(),
  );

  constructor() {
    void this.i18n.enter('garage');
    void this.i18n.enter('public');
    // A view the session may not open sends it to the dashboard's own page.
    effect(() => {
      if (this.view.gone()) void this.router.navigateByUrl('/app/garage');
    });
  }

  private t(key: string, params?: Record<string, string>) {
    return this.i18n.t(key, params);
  }

  // A mobile mechanic is shown by its area, never by an address.
  protected readonly area = computed(() => {
    const garage = this.profile();
    if (garage?.businessKind !== 'mobile') return '';
    return this.t('garage.profile.area', {
      km: formatKm(
        garage.serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
        this.i18n.language(),
      ),
    });
  });
  protected readonly hours = computed(() => {
    const garage = this.profile();
    return garage
      ? hoursLines(garage.hours, this.i18n.language(), (key) => this.t(key))
      : [];
  });
  protected readonly worksOn = computed(() =>
    (this.profile()?.worksOn ?? []).map((brand) => ({
      ...brand,
      fuels: FUELS.filter((fuel) => brand.fuels.includes(fuel))
        .map((fuel) => this.t(`public.requestQuote.fuelWord.${fuel}`))
        .join(' · '),
    })),
  );
  // Every facility the listing can offer, the ones not offered among them.
  protected readonly facilities = computed(() => {
    const garage = this.profile();
    if (!garage) return [];
    const language = this.i18n.language();
    return FACILITIES.map((key) => {
      const label = this.t(`public.listing.hours.facility.${key}`);
      if (!garage.facilities.includes(key)) {
        return {
          key,
          label: this.t('garage.profile.notOffered', { label }),
          offered: false,
        };
      }
      const terms =
        key === 'courtesy_car'
          ? this.carTerms(garage.courtesyCar, language)
          : '';
      return {
        key,
        label: terms ? `${label} · ${terms}` : label,
        offered: true,
      };
    });
  });
  protected readonly payment = computed(() => {
    const methods = PAYMENTS.filter(
      (method) => this.profile()?.paymentMethods[method],
    ).map((method) =>
      this.t(`public.garageProfile.details.payments.${method}`),
    );
    return methods.length
      ? this.t('public.garageProfile.details.payment', {
          methods: methods.join(', '),
        })
      : '';
  });
  protected readonly publicHref = computed(() => {
    const garage = this.profile();
    return garage ? `/${this.i18n.language()}/garages/${garage.slug}` : '';
  });

  // "gratuit", "150 lei / zi", or nothing for a paid car with no price.
  private carTerms(car: GarageProfileDto['courtesyCar'], language: Language) {
    if (!car) return '';
    if (!car.paid) return this.t('public.garageProfile.details.free');
    if (car.pricePerDayBani === undefined) return '';
    return this.t('public.garageProfile.details.perDay', {
      price: formatLei(car.pricePerDayBani, language),
    });
  }

  protected address(garage: GarageProfileDto) {
    return garage.businessKind === 'mobile' ? '' : (garage.address ?? '');
  }
}
