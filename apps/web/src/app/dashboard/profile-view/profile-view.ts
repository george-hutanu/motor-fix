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
import type { Capability } from '@motor-fix/contracts/capabilities';
import { FACILITIES } from '@motor-fix/contracts/garage-hours';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import {
  type GarageBrandOwnerAnswerDto,
  type GarageProfileDto,
  GaragesService,
} from '@motor-fix/data-access';
import { formatKm, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, Lamp } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { liveView } from '../../live/view';
import {
  carTerms,
  fuelLine,
  paymentLine,
} from '../../public/garage-profile/details-section/detail-lines';
import { hoursLines } from '../../public/garage-profile/where-section/hours-lines';
import type { BrandsEditData } from '../brands-edit-dialog/brands-edit-dialog';
import { GarageLegalCheck } from '../garage-legal-check/garage-legal-check';
import { Live } from '../live';
import {
  type ProfileEditData,
  ProfileEditDialog,
  type ProfileGroup,
} from '../profile-edit-dialog/profile-edit-dialog';
import { garageOf, Session } from '../session';
import { WeeklyFiguresPanel } from '../weekly-figures-panel/weekly-figures-panel';

const SUSPENDED = 410;

// "Profilul service-ului": the garage's public profile as drivers see it,
// read only, with the stored phone the public page never shows. The brands,
// fuels, facilities and hours are built as the public profile builds them,
// from the same labels, so the two read the same.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageLegalCheck,
    HlmButton,
    Lamp,
    TranslatePipe,
    WeeklyFiguresPanel,
  ],
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
  private readonly overlays = inject(Overlays);
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
  // The legal check and its upload are the owner's (her switches' row); the
  // receptionist reads the profile alone.
  protected readonly legalCheck = computed(() =>
    (this.session.shown()?.capabilities ?? []).includes(
      'garage.feature_switches' satisfies Capability,
    ),
  );
  // A save's answer, shown at once until the next read lands.
  private readonly saved = signal<{
    profile: GarageProfileDto;
    reads: number;
  } | null>(null);
  protected readonly profile = computed(() => {
    if (this.suspended()) return undefined;
    const saved = this.saved();
    return saved && saved.reads === this.view.reads()
      ? saved.profile
      : this.view.value();
  });

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

  // The owner edits a group of her profile in place; the saved answer shows
  // at once, and the next garage.updated read replaces it.
  protected async edit(group: ProfileGroup) {
    const profile = this.profile();
    if (!profile) return;
    const result = await this.overlays.open<GarageProfileDto, ProfileEditData>(
      ProfileEditDialog,
      {
        confirmDiscard: false,
        data: { garageId: this.garageId(), group, profile },
        shape: 'dialog',
        title: `garage.profile.edit.title.${group}`,
      },
    );
    if (result === 'cancelled') return;
    this.saved.set({ profile: result, reads: this.view.reads() });
  }

  // The brands open a dialog of their own, loaded only when pressed; the
  // saved answer replaces the lists at once, as a group's save does.
  protected async editBrands() {
    const profile = this.profile();
    if (!profile) return;
    const result = await this.overlays.open<
      GarageBrandOwnerAnswerDto,
      BrandsEditData
    >(
      () =>
        import('../brands-edit-dialog/brands-edit-dialog').then(
          (m) => m.BrandsEditDialog,
        ),
      {
        confirmDiscard: false,
        data: { garageId: this.garageId() },
        shape: 'dialog',
        title: 'garage.profile.edit.title.brands',
      },
    );
    if (result === 'cancelled') return;
    const { brandNote, doesNotTake, refusalPhrase, worksOn } = result;
    this.saved.set({
      profile: {
        ...profile,
        brandNote,
        doesNotTake,
        refusalPhrase,
        worksOn: worksOn.map(({ jobs: _, ...brand }) => brand),
      },
      reads: this.view.reads(),
    });
  }

  protected editLabel(group: ProfileGroup | 'brands') {
    return this.t('garage.profile.edit.controlFor', {
      group: this.t(`garage.profile.edit.title.${group}`),
    });
  }

  protected address(garage: GarageProfileDto) {
    return garage.businessKind === 'mobile' ? '' : (garage.address ?? '');
  }
}
