import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { fold } from '@motor-fix/contracts/fold';
import { type AdminBrandDto, AdminService } from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, HlmInput, Lamp, Panel } from '@motor-fix/ui-cockpit';

import { visibleText } from '../../characters';
import {
  AdminBrandAddDialog,
  BRAND_NAME,
} from '../admin-brand-add-dialog/admin-brand-add-dialog';

const SKELETON_ROWS = [0, 1, 2];

// A row's own message: the API's words for a taken name, or a key.
type Notice = { id: string; text?: string; key?: string; status?: boolean };

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

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly state = signal<'loading' | 'failed' | 'ready'>('loading');
  private readonly brands = signal<AdminBrandDto[]>([]);
  protected readonly query = signal('');
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly renameForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [visibleText(BRAND_NAME)],
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
    try {
      const { items } = await this.api.adminBrandsControllerList();
      this.brands.set([...items].sort(byName));
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
    if (this.busy()) return;
    this.notice.set(null);
    this.name.reset(brand.name);
    this.editing.set(brand.id);
  }

  protected cancel() {
    this.editing.set(null);
  }

  protected async rename(brand: AdminBrandDto) {
    if (this.busy()) return;
    this.name.markAsTouched();
    if (this.name.invalid) return;
    const name = this.name.value.trim();
    if (name === brand.name) {
      this.editing.set(null);
      return;
    }
    if (await this.send(brand, { name })) this.editing.set(null);
  }

  protected async setActive(brand: AdminBrandDto, active: boolean) {
    if (this.busy()) return;
    await this.send(brand, { active });
  }

  // True when the row took the change.
  private async send(
    brand: AdminBrandDto,
    change: { name?: string; active?: boolean },
  ) {
    this.busy.set(brand.id);
    this.notice.set(null);
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
      this.busy.set(null);
    }
  }

  // A stale edit takes the row the API sends back and closes the field; a
  // taken name keeps the field open with the API's words; anything else
  // leaves the row as it was.
  private refused(brand: AdminBrandDto, failure: unknown) {
    const body =
      failure instanceof HttpErrorResponse
        ? (failure.error as {
            code?: string;
            detail?: string;
            brand?: AdminBrandDto;
          } | null)
        : null;
    if (body?.code === 'stale_value' && body.brand) {
      this.put(body.brand);
      this.editing.set(null);
      this.notice.set({
        id: brand.id,
        key: 'admin.brands.stale',
        status: true,
      });
      return;
    }
    if (body?.code === 'brand_exists' && body.detail) {
      this.notice.set({ id: brand.id, text: body.detail });
      return;
    }
    this.notice.set({ id: brand.id, key: 'admin.brands.saveFailed' });
  }

  private put(brand: AdminBrandDto) {
    this.brands.update((all) =>
      [...all.filter((b) => b.id !== brand.id), brand].sort(byName),
    );
  }
}
