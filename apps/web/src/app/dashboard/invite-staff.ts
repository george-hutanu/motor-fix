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
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

import { ADDRESS } from '../sign-in/sign-in';
import { characters } from '../sign-in/sign-up';

type Kind = 'mechanic' | 'receptionist';

// The code of a refused send, and the open invite it names, if any.
function refusal(error: unknown): { code?: unknown; inviteId?: unknown } {
  return error instanceof HttpErrorResponse && error.error
    ? (error.error as { code?: unknown; inviteId?: unknown })
    : {};
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
  styles: `
    form, .outcome { display: grid; gap: var(--mf-space-4); }
    .field { display: grid; gap: var(--mf-space-2); }
    .field > label, legend { font-weight: 700; }
    fieldset { display: grid; gap: var(--mf-space-1); margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: var(--mf-space-2); }
    .choice { display: flex; align-items: flex-start; gap: var(--mf-space-3); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; overflow-wrap: anywhere; }
    .choice input { flex: none; width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--mf-amber); }
    .choice input:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
    p { margin: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--mf-space-3); }
    .actions button { white-space: normal; }
  `,
  template: `
    @if (outcome(); as sent) {
      <div class="outcome" role="status">
        @if (sent.emailSent) {
          <p>{{ 'garage.invite.sent' | t }}</p>
          <p>{{ 'garage.invite.sentLine' | t }}</p>
        } @else {
          <p>{{ 'garage.invite.notSent' | t }}</p>
          <p>{{ 'garage.invite.notSentLine' | t }}</p>
        }
        <div class="actions">
          @if (sent.link) {
            <button hlmBtn variant="secondary" type="button" (click)="copy(sent.link)">
              {{ 'garage.invite.copy' | t }}
            </button>
          }
          <button hlmBtn type="button" (click)="task.close('sent')">{{ 'garage.invite.done' | t }}</button>
        </div>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
        <div class="field">
          <label for="mf-invite-name">{{ 'garage.invite.name' | t }}</label>
          <input
            hlmInput
            id="mf-invite-name"
            type="text"
            autocomplete="off"
            formControlName="name"
            aria-describedby="mf-invite-name-error"
          />
          <mf-field-error id="mf-invite-name-error" [save]="save" [control]="form.controls.name" />
        </div>
        <div class="field">
          <label for="mf-invite-email">{{ 'garage.invite.email' | t }}</label>
          <input
            hlmInput
            id="mf-invite-email"
            type="email"
            inputmode="email"
            autocomplete="off"
            spellcheck="false"
            formControlName="email"
            aria-describedby="mf-invite-email-error"
          />
          <mf-field-error id="mf-invite-email-error" [save]="save" [control]="form.controls.email" />
        </div>
        <fieldset>
          <legend>{{ 'garage.invite.kind' | t }}</legend>
          @if (mechanics()) {
            <label class="choice"><input type="radio" formControlName="kind" value="mechanic" />{{ 'garage.invite.mechanic' | t }}</label>
          }
          <label class="choice"><input type="radio" formControlName="kind" value="receptionist" />{{ 'garage.invite.receptionist' | t }}</label>
        </fieldset>
        @if (form.controls.kind.value === 'mechanic') {
          <fieldset>
            <legend>{{ 'garage.invite.permissions' | t }}</legend>
            <label class="choice"><input type="checkbox" formControlName="canMoveBookings" />{{ 'garage.invite.canMoveBookings' | t }}</label>
            <label class="choice"><input type="checkbox" formControlName="canAnswerQuotes" />{{ 'garage.invite.canAnswerQuotes' | t }}</label>
            <label class="choice"><input type="checkbox" formControlName="canRecordFinalPrice" />{{ 'garage.invite.canRecordFinalPrice' | t }}</label>
          </fieldset>
        }
        <mf-task-error [save]="save" />
        <div class="actions">
          @if (inviteId(); as id) {
            <button hlmBtn variant="secondary" type="button" [disabled]="resending()" (click)="resend(id)">
              {{ 'garage.invite.resend' | t }}
            </button>
          }
          <button hlmBtn type="submit" [mfTaskSubmit]="save">{{ 'garage.invite.submit' | t }}</button>
          <button hlmBtn variant="ghost" type="button" (click)="task.close('cancelled')">
            {{ 'garage.invite.cancel' | t }}
          </button>
        </div>
      </form>
    }
  `,
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
        const { code, inviteId } = refusal(error);
        this.inviteId.set(
          code === 'invite_open' && typeof inviteId === 'string'
            ? inviteId
            : null,
        );
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
