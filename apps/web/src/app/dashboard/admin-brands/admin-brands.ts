import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  Injector,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { fold } from '@motor-fix/contracts/fold';
import { type AdminBrandDto, AdminService } from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput, Lamp, Panel } from '@motor-fix/ui-cockpit';

import {
  AdminBrandAddDialog,
  brandName,
  brandNameOf,
} from '../admin-brand-add-dialog/admin-brand-add-dialog';

const SKELETON_ROWS = [0, 1, 2];

// A row's own message: the API's words for a taken name, or a key.
type Notice = { text?: string; key?: string; status?: boolean };

// The brand a `stale_value` answer carries, in a body read as JSON or text.
// Only called once toProblem has read that code, so a text body parses.
const brandIn = (failure: unknown): unknown => {
  if (!(failure instanceof HttpErrorResponse)) return undefined;
  const body: unknown =
    typeof failure.error === 'string'
      ? JSON.parse(failure.error)
      : failure.error;
  return (body as { brand?: unknown } | null)?.brand;
};

// The brand a `stale_value` answer carries, checked before it replaces a row.
const isBrand = (value: unknown, id: string): value is AdminBrandDto => {
  const b = value as Partial<AdminBrandDto> | null;
  return (
    typeof b === 'object' &&
    b !== null &&
    b.id === id &&
    typeof b.name === 'string' &&
    (b.state === 'active' || b.state === 'retired') &&
    typeof b.garages === 'number' &&
    typeof b.cars === 'number' &&
    typeof b.updatedAt === 'string'
  );
};

const byName = (a: AdminBrandDto, b: AdminBrandDto) =>
  fold(a.name).localeCompare(fold(b.name));

// "Lista de mărci": every brand, read once, filtered here as the admin types.
// A row renames in place, retires or brings the brand back; each edit sends
// the updatedAt the admin saw, and a stale one takes the row as it now is.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    Lamp,
    Panel,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  selector: 'mf-admin-brands',
  styleUrl: './admin-brands.css',
  templateUrl: './admin-brands.html',
})
export class AdminBrands {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  // Rows this view wrote while a read was on its way: the read keeps them.
  private readonly written = new Map<string, AdminBrandDto>();

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly state = signal<'loading' | 'failed' | 'ready'>('loading');
  private readonly brands = signal<AdminBrandDto[]>([]);
  protected readonly query = signal('');
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly notices = signal<ReadonlyMap<string, Notice>>(new Map());
  // The open field's name was refused by the 2-40 rule at the last save.
  protected readonly nameRefused = signal(false);
  protected readonly renameForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [brandName],
    }),
  });
  private readonly name = this.renameForm.controls.name;

  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    const query = fold(this.query().trim());
    return this.brands()
      .filter((brand) => fold(brand.name).includes(query))
      .map((brand) => ({
        brand,
        cars: formatNum(brand.cars, language),
        garages: formatNum(brand.garages, language),
      }));
  });

  constructor() {
    void this.i18n.enter('admin');
    void this.read();
  }

  protected async read() {
    this.state.set('loading');
    this.written.clear();
    try {
      const { items } = await this.api.adminBrandsControllerList();
      const read = new Map(items.map((b) => [b.id, b]));
      for (const [id, b] of this.written) read.set(id, b);
      this.written.clear();
      this.brands.set([...read.values()].sort(byName));
      this.state.set('ready');
    } catch {
      this.state.set('failed');
    }
  }

  protected search(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected async add() {
    const made = await this.overlays.open<AdminBrandDto>(AdminBrandAddDialog, {
      shape: 'dialog',
      title: 'admin.brands.add.title',
    });
    if (!made || typeof made !== 'object') return;
    this.query.set('');
    this.put(made);
  }

  protected startRename(brand: AdminBrandDto) {
    if (this.busy().has(brand.id)) return;
    this.note(brand.id, null);
    this.nameRefused.set(false);
    this.name.reset(brand.name);
    this.editing.set(brand.id);
    this.focus(brand.id, 'input');
  }

  protected async rename(brand: AdminBrandDto) {
    if (this.busy().has(brand.id)) return;
    this.name.markAsTouched();
    this.nameRefused.set(this.name.invalid);
    if (this.name.invalid) return;
    const name = brandNameOf(this.name.value);
    if (name === brand.name) {
      this.close(brand.id);
      return;
    }
    if (await this.send(brand, { name })) this.close(brand.id);
  }

  protected async setActive(brand: AdminBrandDto, active: boolean) {
    if (this.busy().has(brand.id)) return;
    await this.send(brand, { active });
    this.focus(brand.id, 'button[data-state-action]');
  }

  // Closes the row's field, focus back on its Rename button.
  protected close(id: string) {
    if (this.editing() !== id) return;
    this.editing.set(null);
    this.focus(id, 'button[data-rename]');
  }

  private focus(id: string, selector: string) {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`tr[data-id="${id}"] ${selector}`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  private note(id: string, notice: Notice | null) {
    this.notices.update((all) => {
      const next = new Map(all);
      if (notice) next.set(id, notice);
      else next.delete(id);
      return next;
    });
  }

  private setBusy(id: string, on: boolean) {
    this.busy.update((all) => {
      const next = new Set(all);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // True when the row took the change.
  private async send(
    brand: AdminBrandDto,
    change: { name?: string; active?: boolean },
  ) {
    this.setBusy(brand.id, true);
    this.note(brand.id, null);
    try {
      const saved = await this.api.adminBrandsControllerUpdate({
        body: { ...change, seenUpdatedAt: brand.updatedAt },
        id: brand.id,
      });
      this.put(saved);
      return true;
    } catch (failure) {
      this.refused(brand, failure);
      return false;
    } finally {
      this.setBusy(brand.id, false);
    }
  }

  // A stale edit takes the row the API sends back and closes the field; a
  // taken name keeps the field open with the API's words; anything else
  // leaves the row as it was.
  private refused(brand: AdminBrandDto, failure: unknown) {
    const { code, detail } = toProblem(failure);
    const current = code === 'stale_value' ? brandIn(failure) : undefined;
    if (current && isBrand(current, brand.id)) {
      this.put(current);
      this.close(brand.id);
      this.note(brand.id, { key: 'admin.brands.stale', status: true });
      return;
    }
    if (code === 'brand_exists' && detail) {
      this.note(brand.id, { text: detail });
      return;
    }
    this.note(brand.id, { key: 'admin.brands.saveFailed' });
  }

  private put(brand: AdminBrandDto) {
    if (this.state() === 'loading') this.written.set(brand.id, brand);
    this.brands.update((all) =>
      [...all.filter((b) => b.id !== brand.id), brand].sort(byName),
    );
  }
}
