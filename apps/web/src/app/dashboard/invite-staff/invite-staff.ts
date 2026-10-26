import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { normalisePhone } from '@motor-fix/contracts/phone';
import {
  GaragesService,
  type StaffInviteSentDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

import { characters } from '../../characters';
import { ADDRESS } from '../../sign-in/sign-in';
import { Session } from '../session';

type Kind = 'mechanic' | 'receptionist';

export type InviteStaffData = {
  card?: { id: string; name: string };
  garageId: string;
};

// A card's invite goes to an e-mail when the value has an "@", else to a
// phone number in any form a person types it.
function recipient(value: string) {
  const typed = value.trim();
  if (typed.includes('@')) return ADDRESS.test(typed) ? { email: typed } : null;
  const phone = normalisePhone(typed);
  return phone ? { phone } : null;
}

// The open invite a refused send names: the problem's one extension.
function openInvite(error: unknown): string | null {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const id = typeof body === 'object' ? body?.inviteId : undefined;
  return typeof id === 'string' ? id : null;
}

// "Invită în echipă": the owner invites a mechanic or a receptionist by
// e-mail. Opened from a card, it invites that card's mechanic by e-mail or
// phone, with no name or role to ask. A mechanic's three permissions start
// unticked. When the e-mail
// could not go out, the link is offered to copy; an address with an invite
// still open can have it sent again. Mecanic is offered only while the
// garage has its team on, as the session last read it. Closes with "sent"
// from "Gata".
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-invite-staff',
  styleUrl: './invite-staff.css',
  templateUrl: './invite-staff.html',
})
export class InviteStaff {
  private readonly garages = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly session = inject(Session);
  protected readonly task = injectOverlayTask<
    InviteStaffData,
    'sent' | 'cancelled'
  >();
  protected readonly card = this.task.data.card;

  protected readonly outcome = signal<StaffInviteSentDto | null>(null);
  protected readonly inviteId = signal<string | null>(null);
  protected readonly resending = signal(false);
  // The server refused a mechanic: the session had not heard of the switch.
  private readonly refused = signal(false);
  protected readonly mechanics = computed(
    () =>
      !this.refused() &&
      this.session
        .current()
        ?.garageAccess.find((g) => g.garageId === this.task.data.garageId)
        ?.features?.['team_mechanics'] !== false,
  );

  protected readonly form = new FormGroup({
    canAnswerQuotes: new FormControl(false, { nonNullable: true }),
    canMoveBookings: new FormControl(false, { nonNullable: true }),
    canRecordFinalPrice: new FormControl(false, { nonNullable: true }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [characters(3, 254, true), (c) => this.address(c.value)],
    }),
    kind: new FormControl<Kind>('mechanic', { nonNullable: true }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [characters(2, 80, true)],
    }),
    to: new FormControl('', {
      nonNullable: true,
      // Not one of the shared keys, so its message is the dialog's own
      // `field.invalid`.
      validators: [(c) => (recipient(c.value) ? null : { invalid: true })],
    }),
  });

  protected readonly save = taskSave({
    done: (sent: StaffInviteSentDto) => this.outcome.set(sent),
    form: this.form,
    messages: 'garage.invite',
    send: async () => {
      this.inviteId.set(null);
      try {
        return await this.garages.garageInvitesControllerSend({
          body: this.body(),
          garageId: this.task.data.garageId,
        });
      } catch (error) {
        const { code } = toProblem(error);
        this.inviteId.set(code === 'invite_open' ? openInvite(error) : null);
        // The garage has mechanics switched off: only a receptionist is left.
        if (code === 'feature_off') this.refused.set(true);
        throw error;
      }
    },
  });

  constructor() {
    void this.i18n.enter('garage');
    const { email, kind, name, to } = this.form.controls;
    for (const control of this.card ? [email, kind, name] : [to]) {
      control.disable();
    }
    effect(() => {
      if (!this.mechanics()) this.form.controls.kind.setValue('receptionist');
    });
  }

  private address(value: string) {
    return value.trim() === '' || ADDRESS.test(value)
      ? null
      : { pattern: true };
  }

  private body() {
    const { email, kind, name, to, ...ticks } = this.form.getRawValue();
    if (this.card) {
      return {
        ...ticks,
        kind: 'mechanic' as const,
        mechanicId: this.card.id,
        ...recipient(to),
      };
    }
    const person = { email: email.trim(), kind, name: name.trim() };
    return kind === 'mechanic' ? { ...person, ...ticks } : person;
  }

  protected async resend(id: string) {
    this.resending.set(true);
    try {
      this.outcome.set(
        await this.garages.garageInvitesControllerResend({
          garageId: this.task.data.garageId,
          id,
        }),
      );
      this.task.markUnchanged();
    } catch {
      toast(this.i18n.t('shell.form.problem.error'));
    } finally {
      this.resending.set(false);
    }
  }

  protected async copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast(this.i18n.t('garage.invite.copied'));
    } catch {
      toast(this.i18n.t('garage.invite.copyFailed'));
    }
  }
}
