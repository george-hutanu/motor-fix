import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { type AdminBrandDto, AdminService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { visibleText } from '../../characters';

// The bound the API keeps on a brand's name: 2 to 40 characters that show.
export const BRAND_NAME = { max: 40, min: 2 };

// A name as it is sent: composed, so a letter typed with a combining accent
// ("S" + U+030C) is the one character "Š", and trimmed.
export const brandNameOf = (value: string) => value.normalize('NFC').trim();

// The API's rule on the composed name, so the field counts letters, not
// the code points a keyboard happened to type.
export const brandName = (control: AbstractControl) =>
  visibleText(BRAND_NAME)({
    value: brandNameOf(String(control.value ?? '')),
  } as AbstractControl);

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
  protected readonly task = injectOverlayTask<
    undefined,
    OverlayResult<AdminBrandDto>
  >();

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [brandName],
    }),
  });

  protected readonly save = taskSave({
    done: (brand: AdminBrandDto) => this.task.close(brand),
    form: this.form,
    messages: 'admin.brands.add',
    send: ({ name = '' }) =>
      this.api.adminBrandsControllerCreate({
        body: { name: brandNameOf(name) },
      }),
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
