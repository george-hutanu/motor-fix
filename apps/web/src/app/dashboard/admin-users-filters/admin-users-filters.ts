import {
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  type OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATES,
  type AccountRole,
  type AccountState,
  isAccountState,
  SEARCH_MAX,
  settleSearch,
} from '@motor-fix/contracts/account-search';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmPopoverImports } from '@motor-fix/ui-cockpit';

import {
  AdminUsersFiltersSheet,
  type UsersFilter,
} from '../admin-users-filters-sheet/admin-users-filters-sheet';

// The wait after the last key before the text is searched for.
const SETTLE_MS = 300;

// The text the box commits for what it holds.
const committed = (value: string) => settleSearch(value).slice(0, SEARCH_MAX);

// The accounts' search box, role ticks and state: from 768 px one row, below
// it the search box over one button opening the same filters in a sheet.
@Component({
  imports: [HlmPopoverImports, TranslatePipe],
  selector: 'mf-admin-users-filters',
  styleUrl: './admin-users-filters.css',
  templateUrl: './admin-users-filters.html',
})
export class AdminUsersFilters implements OnDestroy {
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly box =
    viewChild.required<ElementRef<HTMLInputElement>>('box');
  private wait: ReturnType<typeof setTimeout> | undefined;

  readonly q = input.required<string>();
  readonly roles = input.required<readonly AccountRole[]>();
  readonly status = input.required<AccountState | null>();
  // The settled search text, 300 ms after the last key or at once when cleared.
  readonly search = output<string>();
  // The roles and state, at each change.
  readonly filter = output<UsersFilter>();

  protected readonly max = SEARCH_MAX;
  // What the box holds: the address's text until the admin types. When the
  // address only catches up with what was typed (its settled form), the typed
  // text stays, so a trailing space survives the round trip.
  protected readonly text = linkedSignal<string, string>({
    computation: (q, previous) =>
      previous !== undefined && committed(previous.value) === q
        ? previous.value
        : q,
    source: this.q,
  });

  protected readonly roleOptions = computed(() =>
    ACCOUNT_ROLES.map((key) => ({
      key,
      name: this.i18n.t(`admin.users.roles.${key}`),
    })),
  );
  protected readonly stateOptions = computed(() =>
    ACCOUNT_STATES.map((key) => ({
      key,
      name: this.i18n.t(`admin.users.state.${key}`),
    })),
  );

  // The last choice made here, until the address it was written to arrives:
  // a tick right after another keeps both.
  private readonly chosen = linkedSignal<UsersFilter>(() => ({
    roles: this.roles(),
    status: this.status(),
  }));

  protected readonly rolesName = computed(() => {
    const roles = this.roles();
    if (roles.length === 0) return this.i18n.t('admin.users.filters.allRoles');
    if (roles.length === 1) return this.i18n.t(`admin.users.roles.${roles[0]}`);
    return this.i18n.t('admin.users.filters.someRoles', {
      count: roles.length,
      n: roles.length,
    });
  });
  protected readonly summary = computed(() => {
    const status = this.status();
    const state = status
      ? this.i18n.t(`admin.users.state.${status}`)
      : this.i18n.t('admin.users.filters.allStates');
    return `${this.rolesName()} · ${state}`;
  });

  constructor() {
    void this.i18n.enter('admin');
  }

  focusSearch() {
    this.box().nativeElement.focus();
  }

  protected type(value: string) {
    this.text.set(value);
    clearTimeout(this.wait);
    this.wait = setTimeout(() => {
      this.wait = undefined;
      this.search.emit(committed(value));
    }, SETTLE_MS);
  }

  protected clear() {
    clearTimeout(this.wait);
    this.wait = undefined;
    this.text.set('');
    this.search.emit('');
    this.focusSearch();
  }

  protected toggle(role: AccountRole, on: boolean) {
    const roles = this.chosen().roles;
    this.emit({
      ...this.chosen(),
      roles: ACCOUNT_ROLES.filter((r) => (r === role ? on : roles.includes(r))),
    });
  }

  protected chooseState(value: string) {
    this.emit({
      ...this.chosen(),
      status: isAccountState(value) ? value : null,
    });
  }

  private emit(choice: UsersFilter) {
    this.chosen.set(choice);
    this.filter.emit(choice);
  }

  protected async openSheet() {
    const chosen = await this.overlays.open<UsersFilter, UsersFilter>(
      AdminUsersFiltersSheet,
      {
        confirmDiscard: false,
        data: { roles: this.roles(), status: this.status() },
        shape: 'dialog',
        title: 'admin.users.filters.title',
      },
    );
    if (chosen !== 'cancelled') this.emit(chosen);
  }

  ngOnDestroy() {
    clearTimeout(this.wait);
  }
}
