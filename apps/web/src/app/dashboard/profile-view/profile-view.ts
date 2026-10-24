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
import { FACILITIES } from '@motor-fix/contracts/garage-hours';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { type GarageProfileDto, GaragesService } from '@motor-fix/data-access';
import { formatKm, I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, Lamp } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { liveView } from '../../live/view';
import {
  carTerms,
  fuelLine,
  paymentLine,
} from '../../public/garage-profile/details-section/detail-lines';
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
  imports: [HlmButton, Lamp, TranslatePipe],
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
        .on([
          'garage.updated',
          'garage.suspended',
          'garage.restored',
          'facility.removed',
          'facility.re_add_decided',
        ])
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
      fuels: fuelLine(brand.fuels, (key) => this.t(key)),
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
          ? carTerms(garage.courtesyCar, language, (key, params) =>
              this.t(key, params),
            )
          : '';
      return {
        key,
        label: terms ? `${label} · ${terms}` : label,
        offered: true,
      };
    });
  });
  protected readonly payment = computed(() =>
    paymentLine(this.profile()?.paymentMethods, (key, params) =>
      this.t(key, params),
    ),
  );
  protected readonly publicHref = computed(() => {
    const garage = this.profile();
    return garage
      ? `/${this.i18n.language()}/garages/${encodeURIComponent(garage.slug)}`
      : '';
  });

  protected address(garage: GarageProfileDto) {
    return garage.businessKind === 'mobile' ? '' : (garage.address ?? '');
  }
}
