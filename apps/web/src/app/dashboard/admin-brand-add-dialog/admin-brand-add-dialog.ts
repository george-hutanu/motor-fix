import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { type AdminBrandDto, AdminService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { visibleText } from '../../characters';

// The bound the API keeps on a brand's name: 2 to 40 characters that show.
export const BRAND_NAME = { max: 40, min: 2 };

// A new brand, by name. Closes with the brand the API made; a name already
// taken keeps the dialog open with the API's own message under the field.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-admin-brand-add-dialog',
  styleUrl: './admin-brand-add-dialog.css',
  templateUrl: './admin-brand-add-dialog.html',
})
export class AdminBrandAddDialog {
  private readonly api = inject(AdminService);
  private readonly task = injectOverlayTask<undefined, AdminBrandDto>();

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [visibleText(BRAND_NAME)],
    }),
  });

  protected readonly save = taskSave({
    done: (brand: AdminBrandDto) => this.task.close(brand),
    form: this.form,
    messages: 'admin.brands.add',
    send: ({ name = '' }) =>
      this.api.adminBrandsControllerCreate({ body: { name: name.trim() } }),
  });

  // The API names the brand that already has this name, in its own words.
  protected readonly exists = computed(() => {
    const problem = this.save.problem();
    return problem?.code === 'brand_exists' ? (problem.detail ?? null) : null;
  });

  constructor() {
    void inject(I18n).enter('admin');
  }
}
