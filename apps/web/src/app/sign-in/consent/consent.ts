import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import type { TaskSave } from '@motor-fix/overlays';

// The tick every form that creates an account carries, whatever the sign-in
// method: it starts empty and the form is not sent until it is set.
export const consentControl = () =>
  new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe],
  selector: 'mf-consent',
  styleUrl: './consent.css',
  templateUrl: './consent.html',
})
export class Consent {
  readonly control = input.required<FormControl<boolean>>();
  readonly save = input.required<TaskSave<unknown>>();
  // A page holding two ticks gives each its own.
  readonly errorId = input('mf-consent-error');

  protected readonly lang = inject(I18n).language;
  protected readonly invalid = computed(
    () => this.save().fieldError(this.control()) !== null,
  );
}
