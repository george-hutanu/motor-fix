import { Component, computed, inject, signal } from '@angular/core';
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATES,
  type AccountRole,
  type AccountState,
} from '@motor-fix/contracts/account-search';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// The roles ticked (none is every role) and the one state (null is every one).
export interface UsersFilter {
  roles: readonly AccountRole[];
  status: AccountState | null;
}

// The phone's account filters: the roles as ticks above the states as one
// choice; "Aplică" closes with the choice, Escape or the close button with
// no change.
@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-admin-users-filters-sheet',
  styleUrl: './admin-users-filters-sheet.css',
  templateUrl: './admin-users-filters-sheet.html',
})
export class AdminUsersFiltersSheet {
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<UsersFilter, UsersFilter>();
  protected readonly roleOptions = computed(() =>
    ACCOUNT_ROLES.map((key) => ({
      key,
      name: this.i18n.t(`admin.users.roles.${key}`),
    })),
  );
  protected readonly stateOptions = computed(() => [
    { key: null, name: this.i18n.t('admin.users.filters.allStates') },
    ...ACCOUNT_STATES.map((key) => ({
      key,
      name: this.i18n.t(`admin.users.state.${key}`),
    })),
  ]);
  protected readonly roles = signal<readonly AccountRole[]>(
    this.task.data.roles,
  );
  protected readonly status = signal<AccountState | null>(
    this.task.data.status,
  );

  constructor() {
    void this.i18n.enter('admin');
  }

  protected toggle(role: AccountRole, on: boolean) {
    this.roles.update((roles) =>
      ACCOUNT_ROLES.filter((r) => (r === role ? on : roles.includes(r))),
    );
  }

  protected apply() {
    this.task.close({ roles: this.roles(), status: this.status() });
  }
}
