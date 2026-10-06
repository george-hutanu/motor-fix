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
  styles: `
    :host { display: grid; gap: var(--mf-space-2); }
    label { display: flex; align-items: flex-start; gap: var(--mf-space-3); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; overflow-wrap: anywhere; }
    input { flex: none; width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--mf-amber); }
    a { display: inline; min-height: 0; color: var(--mf-amber-ink); font-weight: 700; }
    a:focus-visible, input:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
    .error { margin: 0; color: var(--mf-red-ink); font-size: var(--mf-size-small); }
    .error:empty { display: none; }
  `,
  template: `
    <label>
      <input
        type="checkbox"
        [formControl]="control()"
        [attr.aria-describedby]="errorId()"
        [attr.aria-invalid]="invalid() || null"
      />
      <span
        >{{ 'public.consent.before' | t }}<a [href]="'/' + lang() + '/terms'" target="_blank" rel="noopener">{{ 'public.consent.terms' | t }}</a
        >{{ 'public.consent.between' | t }}<a [href]="'/' + lang() + '/privacy'" target="_blank" rel="noopener">{{ 'public.consent.privacy' | t }}</a
        >{{ 'public.consent.after' | t }}</span
      >
    </label>
    <p [id]="errorId()" class="error">@if (invalid()) {{{ 'public.consent.required' | t }}}</p>
  `,
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
