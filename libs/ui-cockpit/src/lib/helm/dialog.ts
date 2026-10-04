import type { BooleanInput } from '@angular/cdk/coercion';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  Directive,
  effect,
  forwardRef,
  inject,
  input,
  isDevMode,
} from '@angular/core';
import { injectCustomClassSettable } from '@spartan-ng/brain/core';
import {
  BrnDialog,
  BrnDialogClose,
  BrnDialogContent,
  BrnDialogOverlay,
  BrnDialogRef,
  BrnDialogTitle,
  BrnDialogTrigger,
} from '@spartan-ng/brain/dialog';

import { HlmButton } from './button';
import { CloseIcon } from './close-icon';

@Directive({
  hostDirectives: [BrnDialogOverlay],
  selector: '[hlmDialogOverlay],hlm-dialog-overlay',
})
export class HlmDialogOverlay {
  constructor() {
    injectCustomClassSettable({
      host: true,
      optional: true,
    })?.setClassToCustomElement('spartan-dialog-overlay');
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'hlmDialog',
  imports: [HlmDialogOverlay],
  providers: [{ provide: BrnDialog, useExisting: forwardRef(() => HlmDialog) }],
  selector: 'hlm-dialog',
  template: `
    <hlm-dialog-overlay />
    <ng-content />
  `,
})
export class HlmDialog extends BrnDialog {}

@Directive({
  host: { 'data-slot': 'dialog-close' },
  hostDirectives: [BrnDialogClose],
  selector: 'button[hlmDialogClose]',
})
export class HlmDialogClose {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-state]': 'state()',
    class: 'spartan-dialog-content',
    'data-slot': 'dialog-content',
  },
  imports: [CloseIcon, HlmButton, HlmDialogClose],
  selector: 'hlm-dialog-content',
  template: `
    <ng-content />
    @if (showCloseButton()) {
      <button
        hlmBtn
        hlmDialogClose
        class="spartan-dialog-close"
        variant="ghost"
        [attr.aria-label]="closeLabel()"
      >
        <mf-close-icon />
      </button>
    }
  `,
})
export class HlmDialogContent {
  private readonly dialogRef = inject(BrnDialogRef);
  readonly showCloseButton = input<boolean, BooleanInput>(true, {
    transform: booleanAttribute,
  });
  readonly closeLabel = input.required<string>();

  constructor() {
    if (!isDevMode()) return;
    effect(() => {
      if (this.showCloseButton() && !this.closeLabel().trim()) {
        console.error(
          'hlm-dialog-content: closeLabel is empty, so the close button has no accessible name.',
        );
      }
    });
  }
  readonly state = computed(() => this.dialogRef.state() ?? 'closed');
}

@Directive({
  hostDirectives: [
    { directive: BrnDialogContent, inputs: ['context', 'class'] },
  ],
  selector: '[hlmDialogPortal]',
})
export class HlmDialogPortal {}

@Directive({
  host: { 'data-slot': 'dialog-trigger' },
  hostDirectives: [
    {
      directive: BrnDialogTrigger,
      inputs: ['id', 'brnDialogTriggerFor: hlmDialogTriggerFor', 'type'],
    },
  ],
  selector: 'button[hlmDialogTrigger],button[hlmDialogTriggerFor]',
})
export class HlmDialogTrigger {}

@Directive({
  host: { class: 'spartan-dialog-header', 'data-slot': 'dialog-header' },
  selector: '[hlmDialogHeader],hlm-dialog-header',
})
export class HlmDialogHeader {}

@Directive({
  host: { class: 'spartan-dialog-title', 'data-slot': 'dialog-title' },
  hostDirectives: [BrnDialogTitle],
  selector: '[hlmDialogTitle]',
})
export class HlmDialogTitle {}

export const HlmDialogImports = [
  HlmDialog,
  HlmDialogClose,
  HlmDialogContent,
  HlmDialogHeader,
  HlmDialogPortal,
  HlmDialogTitle,
  HlmDialogTrigger,
] as const;
