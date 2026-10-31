import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  type AdminRepairDto,
  type AdminRepairListItemDto,
  AdminService,
} from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import type {
  AdminRepairData,
  AdminRepairResult,
} from '../../admin-repair-dialog/admin-repair-dialog';

type Load = 'loading' | 'ready' | 'failed';

// The repairs an account's driver logged on the cars they own now: date and
// car only, each opened in a dialog loaded the first time one is opened.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-admin-account-repairs',
  styleUrl: './admin-account-repairs.css',
  templateUrl: './admin-account-repairs.html',
})
export class AdminAccountRepairs {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);

  readonly accountId = input.required<string>();

  protected readonly state = signal<Load>('loading');
  protected readonly items = signal<AdminRepairListItemDto[]>([]);
  protected readonly truncated = signal(false);
  protected readonly said = signal('');
  protected readonly openFailed = signal(false);
  // One repair opens at a time: a second press waits for the first.
  private opening = false;

  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    return this.items().map((item) => {
      const { brandName, model, year } = item.car;
      const day = formatDay(item.doneOn, language);
      const car = `${brandName} ${model} ${year}`;
      return {
        id: item.id,
        label: this.i18n.t('admin.users.account.repairs.openLabel', {
          car,
          day,
        }),
        line: `${day} · ${car}`,
      };
    });
  });

  constructor() {
    effect(() => {
      const id = this.accountId();
      untracked(() => void this.load(id));
    });
  }

  protected retry() {
    void this.load(this.accountId());
  }

  private async load(id: string) {
    this.state.set('loading');
    try {
      const list = await this.api.adminRepairsControllerList({ id });
      // The drawer may have moved to another account meanwhile.
      if (id !== this.accountId()) return;
      this.items.set(list.items);
      this.truncated.set(list.truncated);
      this.state.set('ready');
    } catch {
      if (id !== this.accountId()) return;
      this.state.set('failed');
    }
  }

  // Read first (the read is what the history records), then the dialog.
  protected async open(id: string) {
    if (this.opening) return;
    this.opening = true;
    this.said.set('');
    this.openFailed.set(false);
    try {
      let repair: AdminRepairDto;
      try {
        repair = await this.api.adminRepairsControllerOpen({ id });
      } catch (failure) {
        if (failure instanceof HttpErrorResponse && failure.status === 404)
          this.gone(id);
        else this.openFailed.set(true);
        return;
      }
      const result = await this.overlays.open<
        AdminRepairResult,
        AdminRepairData
      >(
        () =>
          import('../../admin-repair-dialog/admin-repair-dialog').then(
            (m) => m.AdminRepairDialog,
          ),
        {
          data: { repair, saved: (r) => this.update(r) },
          shape: 'dialog',
          title: 'admin.users.dialogs.repair.title',
        },
      );
      if (result === 'gone') this.gone(id);
    } finally {
      this.opening = false;
    }
  }

  private update(repair: AdminRepairDto) {
    this.items.update((items) =>
      items.map((item) =>
        item.id === repair.id
          ? { car: repair.car, doneOn: repair.doneOn, id: repair.id }
          : item,
      ),
    );
  }

  private gone(id: string) {
    this.items.update((items) => items.filter((item) => item.id !== id));
    this.said.set(this.i18n.t('admin.users.account.repairs.gone'));
  }
}
