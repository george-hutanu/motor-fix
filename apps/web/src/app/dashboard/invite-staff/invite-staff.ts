import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
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

import { ADDRESS } from '../../sign-in/sign-in';
import { characters } from '../../sign-in/sign-up/sign-up';

type Kind = 'mechanic' | 'receptionist';

// The open invite a refused send names: the problem's one extension.
function openInvite(error: unknown): string | null {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const id = typeof body === 'object' ? body?.inviteId : undefined;
  return typeof id === 'string' ? id : null;
}

// "Invită în echipă": the owner invites a mechanic or a receptionist by
// e-mail. A mechanic's three permissions start unticked. When the e-mail
// could not go out, the link is offered to copy; an address with an invite
// still open can have it sent again. Closes with "sent" from "Gata".
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
  protected readonly task = injectOverlayTask<
    { garageId: string },
    'sent' | 'cancelled'
  >();

  protected readonly outcome = signal<StaffInviteSentDto | null>(null);
  protected readonly inviteId = signal<string | null>(null);
  protected readonly resending = signal(false);
  protected readonly mechanics = signal(true);

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
        if (code === 'feature_off') {
          this.mechanics.set(false);
          this.form.controls.kind.setValue('receptionist');
        }
        throw error;
      }
    },
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  private address(value: string) {
    return value.trim() === '' || ADDRESS.test(value)
      ? null
      : { pattern: true };
  }

  private body() {
    const { email, kind, name, ...ticks } = this.form.getRawValue();
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
