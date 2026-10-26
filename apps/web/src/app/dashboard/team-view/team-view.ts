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
import { liveResource } from '../live';
import {
  MechanicCard,
  type MechanicCardData,
} from '../mechanic-card/mechanic-card';
import { Session } from '../session';

// "Mecanici": the owner's team, a row per card in the server's order (the
// owner's own first), read again when a card, an invite or a rating changes.
// A row opens its card; "Adaugă un mecanic" opens an empty one.
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
    [
      'mechanic.added',
      'mechanic.updated',
      'mechanic.removed',
      'invite.sent',
      'invite.revoked',
      'invite.accepted',
      'rating.updated',
    ],
  );
  protected readonly onProfile = computed(
    () => this.view.value()?.items.filter((m) => m.onProfile).length ?? 0,
  );
  // The owner's own row alone is still an empty team.
  protected readonly team = computed(
    () => this.view.value()?.items.some((m) => !m.isOwner) ?? false,
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

  // Why a card with no account is off the profile.
  protected waiting(mechanic: GarageMechanicDto) {
    const invite = mechanic.invite;
    if (!invite) return 'garage.team.state.noAccount';
    return Date.parse(invite.expiresAt) <= Date.now()
      ? 'garage.team.state.inviteExpired'
      : 'garage.team.state.inviteSent';
  }

  protected years(mechanic: GarageMechanicDto) {
    return mechanic.years
      ? this.i18n.t('garage.team.years', { count: mechanic.years })
      : '';
  }

  protected async openCard(card?: GarageMechanicDto) {
    const brands = this.view.value()?.brands ?? [];
    const garageId = this.garageId();
    const outcome = await this.overlays.open<
      'saved' | 'removed',
      MechanicCardData
    >(MechanicCard, {
      data: card
        ? { brands, card, garageId, refresh: () => this.reread(card.id) }
        : { brands, garageId },
      shape: 'dialog',
      ...(card
        ? {
            title: 'garage.mechanicCard.titleEdit',
            titleParams: { name: card.name },
          }
        : { title: 'garage.mechanicCard.title' }),
    });
    if (outcome === 'saved' || outcome === 'removed') this.view.reload();
  }

  private async reread(id: string) {
    await this.view.reload();
    return this.view.value()?.items.find((item) => item.id === id);
  }
}
