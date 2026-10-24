import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  SUSPEND_REASON_MIN as REASON_MIN,
  DATA_REQUEST_REFERENCE as REFERENCE,
  ACCOUNT_NOTE_MAX as TEXT_MAX,
} from '@motor-fix/contracts/account-action-limits';
import { AdminService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

export type AccountAction = 'reset' | 'suspend' | 'restore' | 'delete';

export interface AdminAccountActionData {
  action: AccountAction;
  id: string;
  name: string;
  // The Bucharest day: a request cannot have arrived after it.
  today: string;
}

// Done; done but the reset e-mail was refused; refused because the account
// moved meanwhile (the drawer reads it again); or the account is gone.
export type AccountActionResult = 'done' | 'email_failed' | 'stale' | 'gone';

// The codes another admin's action leaves behind.
const STALE = new Set([
  'account_already_suspended',
  'account_not_suspended',
  'admin_account',
]);

const length = (text: string) => [...text.trim()].length;

// One of the account page's four confirmations: reset access, suspend with a
// reason, restore with an optional note, or delete at the holder's request.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-admin-account-action',
  styleUrl: './admin-account-action.css',
  templateUrl: './admin-account-action.html',
})
export class AdminAccountAction {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly task = injectOverlayTask<
    AdminAccountActionData,
    AccountActionResult | 'cancelled'
  >();

  protected readonly data = this.task.data;
  protected readonly max = TEXT_MAX;
  // The reference's form, shown as the field's example.
  protected readonly example = 'DR-2026-0001';
  protected readonly confirm = computed(() =>
    this.i18n.t(`admin.users.dialogs.${this.data.action}.confirm`),
  );

  protected readonly text = signal('');
  protected readonly reference = signal('');
  protected readonly receivedOn = signal('');
  protected readonly identity = signal(false);
  protected readonly busy = signal(false);
  protected readonly short = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly count = computed(() => length(this.text()));
  protected readonly ready = computed(() => {
    switch (this.data.action) {
      case 'suspend':
      case 'restore':
        return this.count() <= TEXT_MAX;
      case 'delete':
        return (
          REFERENCE.test(this.reference().trim()) &&
          this.receivedOn() !== '' &&
          this.receivedOn() <= this.data.today &&
          this.identity()
        );
      default:
        return true;
    }
  });

  protected typed(event: Event, into: 'text' | 'reference' | 'receivedOn') {
    const value = (event.target as HTMLInputElement).value;
    this[into].set(value);
    if (into === 'text' && this.short() && this.count() >= REASON_MIN)
      this.short.set(false);
  }

  protected ticked(event: Event) {
    this.identity.set((event.target as HTMLInputElement).checked);
  }

  protected cancel() {
    this.task.markUnchanged();
    this.task.close('cancelled');
  }

  async submit(event: Event) {
    event.preventDefault();
    if (this.busy() || !this.ready()) return;
    if (this.data.action === 'suspend' && this.count() < REASON_MIN) {
      this.short.set(true);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.send();
      this.task.markUnchanged();
      this.task.close(result);
    } catch (error) {
      this.refused(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async send(): Promise<AccountActionResult> {
    const id = this.data.id;
    const text = this.text().trim();
    switch (this.data.action) {
      case 'reset': {
        const { email } = await this.api.accountControllerResetAccess({ id });
        return email === 'failed' ? 'email_failed' : 'done';
      }
      case 'suspend':
        await this.api.accountControllerSuspend({ body: { reason: text }, id });
        return 'done';
      case 'restore':
        await this.api.accountControllerRestore({
          body: text === '' ? {} : { note: text },
          id,
        });
        return 'done';
      case 'delete':
        await this.api.accountControllerDeleteOnRequest({
          body: {
            identityChecked: true,
            receivedOn: this.receivedOn(),
            reference: this.reference().trim(),
          },
          id,
        });
        return 'done';
    }
  }

  // A race closes the dialog for the drawer to read again; any other refusal
  // stays here with what was typed, a lost call or a failure with the shared text.
  private refused(error: unknown) {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const problem = toProblem(error);
    if (status === 404) return this.task.close('gone');
    if (status === 409 && STALE.has(problem.code))
      return this.task.close('stale');
    this.error.set(
      status === 0 || status >= 500 || !problem.detail
        ? this.i18n.t('shell.form.problem.error')
        : problem.detail,
    );
  }
}
