import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  type GarageMemberDto,
  type GarageMemberInviteDto,
  GaragesService,
} from '@motor-fix/data-access';
import {
  bucharestDayStart,
  formatDay,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { liveResource } from '../live';
import { Session } from '../session';

// The order a mechanic's ticked permissions are named in.
const PERMISSIONS = [
  'canMoveBookings',
  'canAnswerQuotes',
  'canRecordFinalPrice',
] as const;

// "Persoane cu acces": who holds an account on the owner's garage and the
// invites still waiting, read again whenever one of them changes.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-garage-members',
  styleUrl: './garage-members.css',
  templateUrl: './garage-members.html',
})
export class GarageMembers {
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly session = inject(Session);
  private readonly garageId = computed(
    () => this.session.shown()?.garageId ?? '',
  );
  protected readonly skeletons = [1, 2, 3];
  protected readonly view = liveResource(
    () => this.api.garageMembersControllerList({ garageId: this.garageId() }),
    [
      'invite.sent',
      'invite.revoked',
      'invite.accepted',
      'mechanic.updated',
      'mechanic.removed',
      'member.removed',
    ],
  );

  constructor() {
    void this.i18n.enter('garage');
  }

  protected role(role: GarageMemberDto['role']) {
    return this.i18n.t(`garage.members.role.${role}`);
  }

  protected since(member: GarageMemberDto) {
    return member.since
      ? this.i18n.t('garage.members.since', {
          date: formatDay(member.since, this.i18n.language()),
        })
      : '';
  }

  protected permissions(member: GarageMemberDto) {
    const held = member.permissions;
    if (!held) return '';
    return PERMISSIONS.filter((p) => held[p])
      .map((p) => this.i18n.t(`garage.members.permissions.${p}`))
      .join(', ');
  }

  protected sent(invite: GarageMemberInviteDto) {
    const at = new Date(invite.sentAt).getTime();
    const today = bucharestDayStart(new Date()).getTime();
    const yesterday = bucharestDayStart(new Date(today - 1)).getTime();
    const when =
      at >= today
        ? this.i18n.t('garage.members.invites.today')
        : at >= yesterday
          ? this.i18n.t('garage.members.invites.yesterday')
          : formatDay(invite.sentAt, this.i18n.language());
    return this.i18n.t('garage.members.invites.sent', { when });
  }
}
