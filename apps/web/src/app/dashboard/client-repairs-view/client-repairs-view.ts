import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  CarsService,
  type ClientRepairDto,
  type ClientRepairListDto,
} from '@motor-fix/data-access';
import { DayPipe, I18n, KmPipe, LeiPipe, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import {
  type CorrectRepairData,
  CorrectRepairDialog,
  type CorrectRepairResult,
} from '../correct-repair-dialog/correct-repair-dialog';
import { EmptyState } from '../empty-state/empty-state';
import { liveResource } from '../live';

// What the owner changed on screen since the last read: a saved repair over
// its row, or a row gone. The next read replaces it.
interface Local {
  reads: number;
  saved: ReadonlyMap<string, ClientRepairDto>;
  removed: ReadonlySet<string>;
}

// "Reparații adăugate de clienți": the repairs drivers logged at the owner's
// garage and share with it, newest first as the API orders them, read again
// when one is corrected, shared or no longer shared. A row opens the
// correction dialog; there is no delete.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, EmptyState, HlmButton, KmPipe, LeiPipe, TranslatePipe],
  selector: 'mf-client-repairs-view',
  styleUrl: './client-repairs-view.css',
  templateUrl: './client-repairs-view.html',
})
export class ClientRepairsView {
  private readonly api = inject(CarsService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  protected readonly skeletons = [1, 2, 3];
  protected readonly view = liveResource<ClientRepairListDto>(
    () => this.api.clientRepairsControllerList(),
    ['repair.updated', 'repair.shared', 'repair.unshared'],
  );
  private readonly local = signal<Local | null>(null);
  // A garage the list answers 404 for (suspended, or no longer the owner's)
  // has nothing shared with it: the empty line, never an error.
  protected readonly list = computed<ClientRepairListDto | undefined>(() => {
    const read = this.view.value();
    if (this.view.gone()) return { items: [], truncated: false };
    if (!read) return undefined;
    const local = this.local();
    if (!local || local.reads !== this.view.reads()) return read;
    return {
      items: read.items
        .filter((item) => !local.removed.has(item.id))
        .map((item) => local.saved.get(item.id) ?? item),
      truncated: read.truncated,
    };
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  protected async correct(item: ClientRepairDto) {
    const outcome = await this.overlays.open<
      CorrectRepairResult,
      CorrectRepairData
    >(CorrectRepairDialog, {
      confirmDiscard: false,
      data: { item, refresh: () => this.reread(item.id) },
      shape: 'dialog',
      title: 'garage.clientRepairs.correct.title',
    });
    if (outcome === 'cancelled' || outcome === undefined) return;
    if (outcome === 'unshared') {
      this.change((local) => ({
        ...local,
        removed: new Set([...local.removed, item.id]),
      }));
      toast(this.i18n.t('garage.clientRepairs.unshared'));
      return;
    }
    this.change((local) => ({
      ...local,
      saved: new Map([...local.saved, [outcome.id, outcome]]),
    }));
  }

  // Applies a change on top of the current read; a newer read drops the
  // changes made over an older one.
  private change(apply: (local: Local) => Local) {
    const reads = this.view.reads();
    const current = this.local();
    const base: Local =
      current && current.reads === reads
        ? current
        : { reads, removed: new Set(), saved: new Map() };
    this.local.set(apply(base));
  }

  // The list read again, for the dialog after a 409: the repair as it is now,
  // or nothing when its client stopped sharing it.
  private async reread(id: string) {
    await this.view.reload();
    return this.view.value()?.items.find((item) => item.id === id);
  }
}
