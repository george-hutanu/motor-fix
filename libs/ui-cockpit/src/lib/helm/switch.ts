import type { BooleanInput } from '@angular/cdk/coercion';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  Directive,
  forwardRef,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import type { ChangeFn, TouchFn } from '@spartan-ng/brain/forms';
import { BrnSwitch, BrnSwitchThumb } from '@spartan-ng/brain/switch';

@Directive({
  host: { class: 'spartan-switch-thumb', 'data-slot': 'switch-thumb' },
  hostDirectives: [BrnSwitchThumb],
  selector: '[hlmSwitchThumb],hlm-switch-thumb',
})
export class HlmSwitchThumb {}

// The rendered button is the 44 px target; cockpit.css draws the track
// inside it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-describedby]': 'null',
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
    class: 'contents',
    'data-slot': 'switch',
  },
  imports: [BrnSwitch, HlmSwitchThumb],
  providers: [
    {
      multi: true,
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => HlmSwitch),
    },
  ],
  selector: 'hlm-switch',
  template: `
    <brn-switch
      class="spartan-switch"
      [checked]="checked()"
      [disabled]="disabledState()"
      [id]="inputId()"
      [aria-label]="ariaLabel()"
      [aria-labelledby]="ariaLabelledby()"
      [aria-describedby]="ariaDescribedby()"
      (checkedChange)="handleChange($event)"
      (touched)="onTouched?.()"
    >
      <hlm-switch-thumb />
    </brn-switch>
  `,
})
export class HlmSwitch implements ControlValueAccessor {
  readonly checkedInput = input<boolean, BooleanInput>(false, {
    alias: 'checked',
    transform: booleanAttribute,
  });
  readonly checked = linkedSignal(this.checkedInput);
  readonly checkedChange = output<boolean>();
  readonly disabled = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaLabelledby = input<string | null>(null, {
    alias: 'aria-labelledby',
  });
  readonly ariaDescribedby = input<string | null>(null, {
    alias: 'aria-describedby',
  });

  protected readonly disabledState = linkedSignal(this.disabled);
  protected onChange?: ChangeFn<boolean>;
  protected onTouched?: TouchFn;

  protected handleChange(value: boolean): void {
    this.checked.set(value);
    this.onChange?.(value);
    this.checkedChange.emit(value);
  }

  writeValue(value: boolean): void {
    this.checked.set(Boolean(value));
  }

  registerOnChange(fn: ChangeFn<boolean>): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: TouchFn): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
