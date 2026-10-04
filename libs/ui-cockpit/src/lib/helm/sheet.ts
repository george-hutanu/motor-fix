import type { BooleanInput } from '@angular/cdk/coercion';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  Directive,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import {
  injectCustomClassSettable,
  injectExposedSideProvider,
  injectExposesStateProvider,
} from '@spartan-ng/brain/core';
import { BrnDialog } from '@spartan-ng/brain/dialog';
import {
  BrnSheet,
  BrnSheetClose,
  BrnSheetContent,
  BrnSheetOverlay,
  BrnSheetTitle,
  BrnSheetTrigger,
} from '@spartan-ng/brain/sheet';

import { HlmButton } from './button';
import { CloseIcon } from './close-icon';

@Directive({
  hostDirectives: [BrnSheetOverlay],
  selector: '[hlmSheetOverlay],hlm-sheet-overlay',
})
export class HlmSheetOverlay {
  constructor() {
    injectCustomClassSettable({
      host: true,
      optional: true,
    })?.setClassToCustomElement('spartan-sheet-overlay');
  }
}

// The drawer: Spartan's sheet, sliding in from a side.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'hlmSheet',
  imports: [HlmSheetOverlay],
  providers: [
    { provide: BrnDialog, useExisting: forwardRef(() => BrnSheet) },
    { provide: BrnSheet, useExisting: forwardRef(() => HlmSheet) },
  ],
  selector: 'hlm-sheet',
  template: `
    <hlm-sheet-overlay />
    <ng-content />
  `,
})
export class HlmSheet extends BrnSheet {}

@Directive({
  host: { 'data-slot': 'sheet-close' },
  hostDirectives: [BrnSheetClose],
  selector: 'button[hlmSheetClose]',
})
export class HlmSheetClose {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-side]': 'sideProvider.side()',
    '[attr.data-state]': 'state()',
    class: 'spartan-sheet-content',
    'data-slot': 'sheet-content',
  },
  imports: [CloseIcon, HlmButton, HlmSheetClose],
  selector: 'hlm-sheet-content',
  template: `
    <ng-content />
    @if (showCloseButton()) {
      <button
        hlmBtn
        hlmSheetClose
        class="spartan-sheet-close"
        variant="ghost"
        [attr.aria-label]="closeLabel()"
      >
        <mf-close-icon />
      </button>
    }
  `,
})
export class HlmSheetContent {
  protected readonly sideProvider = injectExposedSideProvider({ host: true });
  readonly state =
    injectExposesStateProvider({ host: true }).state ?? signal('closed');
  readonly showCloseButton = input<boolean, BooleanInput>(true, {
    transform: booleanAttribute,
  });
  readonly closeLabel = input.required<string>();
}

@Directive({
  hostDirectives: [
    { directive: BrnSheetContent, inputs: ['context', 'class'] },
  ],
  selector: '[hlmSheetPortal]',
})
export class HlmSheetPortal {}

@Directive({
  host: { 'data-slot': 'sheet-trigger' },
  hostDirectives: [
    { directive: BrnSheetTrigger, inputs: ['id', 'side', 'type'] },
  ],
  selector: 'button[hlmSheetTrigger]',
})
export class HlmSheetTrigger {}

@Directive({
  host: { class: 'spartan-sheet-header', 'data-slot': 'sheet-header' },
  selector: '[hlmSheetHeader],hlm-sheet-header',
})
export class HlmSheetHeader {}

@Directive({
  host: { class: 'spartan-sheet-title', 'data-slot': 'sheet-title' },
  hostDirectives: [BrnSheetTitle],
  selector: '[hlmSheetTitle]',
})
export class HlmSheetTitle {}

export const HlmSheetImports = [
  HlmSheet,
  HlmSheetClose,
  HlmSheetContent,
  HlmSheetHeader,
  HlmSheetPortal,
  HlmSheetTitle,
  HlmSheetTrigger,
] as const;
