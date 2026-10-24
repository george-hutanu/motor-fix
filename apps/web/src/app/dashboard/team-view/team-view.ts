import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { type GarageMechanicDto, GaragesService } from '@motor-fix/data-access';
import { formatRating, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { EmptyState } from '../empty-state/empty-state';
import { InviteStaff } from '../invite-staff/invite-staff';
import { liveResource } from '../live';
import { Session } from '../session';

// "Mecanici": the owner's team, a row per card in the server's order, read
// again when a card, an invite or a rating changes.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, HlmButton, TranslatePipe],
  selector: 'mf-team-view',
  styleUrl: './team-view.css',
  templateUrl: './team-view.html',
})
export class TeamView {
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly garageId = computed(
    () => this.session.shown()?.garageId ?? '',
  );
  protected readonly skeletons = [1, 2, 3];
  protected readonly view = liveResource(
    () => this.api.garageMechanicsControllerList({ garageId: this.garageId() }),
    ['mechanic.updated', 'invite.accepted', 'rating.updated'],
  );
  protected readonly onProfile = computed(
    () => this.view.value()?.items.filter((m) => m.onProfile).length ?? 0,
  );

  constructor() {
    void this.i18n.enter('garage');
    // A garage that switched its team off, or is no longer the owner's.
    effect(() => {
      if (!this.view.gone()) return;
      const home = this.session.shown()?.landing;
      untracked(() => void this.router.navigateByUrl(home ?? '/'));
    });
  }

  protected rating(mechanic: GarageMechanicDto) {
    if (!mechanic.reviewCount || mechanic.rating === null) {
      return this.i18n.t('garage.team.noReviews');
    }
    return this.i18n.t('garage.team.reviews', {
      count: mechanic.reviewCount,
      rating: formatRating(Number(mechanic.rating), this.i18n.language()),
    });
  }

  protected invite() {
    void this.overlays.open<'sent', { garageId: string }>(InviteStaff, {
      data: { garageId: this.garageId() },
      shape: 'dialog',
      title: 'garage.invite.title',
    });
  }
}
