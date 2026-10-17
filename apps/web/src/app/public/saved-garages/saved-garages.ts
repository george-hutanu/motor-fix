import { Injectable, inject, signal } from '@angular/core';
import {
  type SavedGarageDto,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { Session } from '../../dashboard/session';
import { httpStatus } from '../../http-status';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

// The garage a visitor tapped while signing in, for this tab only: a sign-in
// through a provider leaves the page, and the page it comes back to saves it.
const PENDING = 'mf-pending-save';

function pending(): string | null {
  try {
    return sessionStorage.getItem(PENDING);
  } catch {
    return null;
  }
}

function keep(garageId: string | null) {
  try {
    if (garageId) sessionStorage.setItem(PENDING, garageId);
    else sessionStorage.removeItem(PENDING);
  } catch {
    // Storage refused: a provider sign-in then saves nothing, as before.
  }
}

const added = (set: ReadonlySet<string>, id: string) => new Set(set).add(id);
const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

// Which garages the signed-in driver saved, shared by every save control on
// the page. A change shows at once and goes back if the server refuses it.
@Injectable({ providedIn: 'root' })
export class SavedGarages {
  private readonly api = inject(SavedGaragesService);
  private readonly session = inject(Session);
  private readonly signIn = inject(SignInDialog);
  private readonly i18n = inject(I18n);

  readonly ids = signal<ReadonlySet<string>>(new Set());
  // Garages the server no longer lets anyone save (not approved any more).
  readonly unavailable = signal<ReadonlySet<string>>(new Set());
  private readonly inFlight = new Set<string>();
  // Garages tapped while an ids read is out: its answer predates the tap.
  private touched: Set<string> | null = null;
  private reading: Promise<void> | null = null;
  private bar: string | number | null = null;

  // Once per route activation. A visitor's page asks nobody; a browser last
  // seen as a driver confirms its session first.
  async load(): Promise<void> {
    const role = this.session.current()?.role ?? this.session.roleHint();
    // A tap kept for a sign-in that brought back another role saves nothing,
    // now or after a later driver sign-in in this tab.
    if (role !== 'driver') {
      if (role) keep(null);
      return;
    }
    if ((await this.session.load())?.role !== 'driver') {
      keep(null);
      return;
    }
    await this.read();
    const kept = pending();
    if (!kept) return;
    keep(null);
    if (!this.ids().has(kept)) await this.save(kept);
  }

  async tap(garageId: string): Promise<void> {
    if (this.inFlight.has(garageId)) return;
    if (!this.session.current()) return this.signInThenSave(garageId);
    if (this.session.current()?.role !== 'driver') return;
    return this.ids().has(garageId)
      ? this.remove(garageId)
      : this.save(garageId);
  }

  private async signInThenSave(garageId: string) {
    this.inFlight.add(garageId);
    try {
      // A page opened by its address has not loaded the session yet:
      // someone signed in is not asked to sign in again.
      if (!(await this.session.load())) {
        keep(garageId);
        const signed = await this.signIn.gate();
        keep(null);
        if (!signed) return;
      }
      if (this.session.current()?.role !== 'driver') return;
      // What this account saved before, so the tap never removes one.
      await this.read();
    } finally {
      this.inFlight.delete(garageId);
    }
    if (!this.ids().has(garageId)) await this.save(garageId);
  }

  // One read at a time: a second caller shares the one that is out.
  private read(): Promise<void> {
    this.reading ??= this.readIds().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async readIds() {
    const touched = new Set<string>();
    this.touched = touched;
    try {
      const { ids } = await this.api.savedGaragesControllerIds();
      const next = new Set(ids);
      for (const id of touched) {
        if (this.ids().has(id)) next.add(id);
        else next.delete(id);
      }
      this.ids.set(next);
    } catch {
      // The controls stay unsaved and usable; a tap tells the truth.
    } finally {
      this.touched = null;
    }
  }

  // `savedAt` is an undo's: the first time comes back, with no toast.
  private async save(garageId: string, savedAt?: string, announce = true) {
    this.inFlight.add(garageId);
    this.touched?.add(garageId);
    this.ids.update((ids) => added(ids, garageId));
    try {
      await this.api.savedGaragesControllerSave({
        body: savedAt ? { savedAt } : {},
        garageId,
      });
      if (announce) toast(this.i18n.t('public.saveGarage.savedToast'));
    } catch (error) {
      this.ids.update((ids) => without(ids, garageId));
      const status = httpStatus(error);
      if (status === 404)
        this.unavailable.update((ids) => added(ids, garageId));
      else this.fail(status);
    } finally {
      this.inFlight.delete(garageId);
    }
  }

  // Also the dashboard list's remove button: the same bar and undo.
  async remove(garageId: string) {
    this.inFlight.add(garageId);
    this.touched?.add(garageId);
    this.ids.update((ids) => without(ids, garageId));
    if (this.bar !== null) toast.dismiss(this.bar);
    const removal = this.api.savedGaragesControllerRemove({ garageId });
    let undone = false;
    const bar = toast(this.i18n.t('public.saveGarage.removed'), {
      action: {
        label: this.i18n.t('public.saveGarage.undo'),
        // One undo per bar, however often the button is pressed.
        onClick: () => {
          if (undone) return;
          undone = true;
          void this.undo(garageId, removal);
        },
      },
      duration: 8000,
    });
    this.bar = bar;
    try {
      await removal;
    } catch (error) {
      this.ids.update((ids) => added(ids, garageId));
      toast.dismiss(bar);
      if (this.bar === bar) this.bar = null;
      this.fail(httpStatus(error));
    } finally {
      this.inFlight.delete(garageId);
    }
  }

  // Tapped before the removal answered, it waits for the time to send back.
  private async undo(
    garageId: string,
    removal: Promise<SavedGarageDto | null>,
  ) {
    let row: SavedGarageDto | null;
    try {
      row = await removal;
    } catch {
      return;
    }
    // A tap saved it again meanwhile: that save stands.
    if (this.inFlight.has(garageId) || this.ids().has(garageId)) return;
    await this.save(garageId, row?.savedAt, false);
  }

  private fail(status: number) {
    toast(
      this.i18n.t(
        status === 0
          ? 'public.saveGarage.noConnection'
          : 'public.saveGarage.failed',
      ),
    );
  }
}
