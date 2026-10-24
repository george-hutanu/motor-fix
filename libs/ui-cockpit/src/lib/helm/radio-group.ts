import type { BooleanInput } from '@angular/cdk/coercion';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  Directive,
  inject,
  input,
} from '@angular/core';
import { BrnRadio, BrnRadioGroup } from '@spartan-ng/brain/radio-group';

// One choice among a few, saved by its owner on `valueChange`. The native
// radios share the group's name, so the arrow keys move the choice.
@Directive({
  host: { class: 'spartan-radio-group', 'data-slot': 'radio-group' },
  hostDirectives: [
    {
      directive: BrnRadioGroup,
      inputs: ['name', 'value', 'disabled', 'required'],
      outputs: ['valueChange'],
    },
  ],
  selector: '[hlmRadioGroup]',
})
export class HlmRadioGroup {
  private readonly group = inject(BrnRadioGroup);

  get name(): string {
    return this.group.name();
  }

  // Shows `value` again after a pick its owner did not keep, even when the
  // owner's bound value never changed in between.
  reset(value: string) {
    this.group.writeValue(value);
  }
}

// Each option is a 44 px chip: the label is the target, the native radio
// inside it stays visually hidden and takes the focus.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-describedby]': 'null',
    '[attr.id]': 'null',
    'data-slot': 'radio',
  },
  imports: [BrnRadio],
  selector: 'hlm-radio',
  template: `
    <brn-radio
      class="spartan-radio"
      [id]="inputId()"
      [value]="value()"
      [disabled]="disabled()"
      [aria-describedby]="ariaDescribedby()"
    >
      <label class="spartan-radio-label" [attr.for]="inputId()">
        <span class="spartan-radio-dot" aria-hidden="true"></span>
        <ng-content />
      </label>
    </brn-radio>
  `,
})
export class HlmRadio {
  readonly value = input.required<string>();
  readonly inputId = input.required<string>();
  readonly disabled = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly ariaDescribedby = input<string | undefined>(undefined, {
    alias: 'aria-describedby',
  });
}

export const HlmRadioImports = [HlmRadioGroup, HlmRadio] as const;
