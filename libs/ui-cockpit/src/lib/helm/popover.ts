import { Directive, ElementRef, effect, inject, signal } from '@angular/core';
import { injectExposesStateProvider } from '@spartan-ng/brain/core';
import {
  BrnPopover,
  BrnPopoverContent,
  BrnPopoverTrigger,
} from '@spartan-ng/brain/popover';

@Directive({
  host: { 'data-slot': 'popover' },
  hostDirectives: [
    {
      directive: BrnPopover,
      inputs: ['align', 'sideOffset', 'offsetX'],
      outputs: ['stateChanged', 'closed'],
    },
  ],
  selector: '[hlmPopover],hlm-popover',
})
export class HlmPopover {}

@Directive({
  host: { class: 'spartan-popover-content', 'data-slot': 'popover-content' },
  selector: '[hlmPopoverContent],hlm-popover-content',
})
export class HlmPopoverContent {
  readonly state =
    injectExposesStateProvider({ host: true }).state ?? signal('closed');

  constructor() {
    const element = inject(ElementRef<HTMLElement>).nativeElement;
    effect(() => element.setAttribute('data-state', this.state()));
  }
}

@Directive({
  hostDirectives: [
    { directive: BrnPopoverContent, inputs: ['context', 'class'] },
  ],
  selector: '[hlmPopoverPortal]',
})
export class HlmPopoverPortal {}

@Directive({
  host: { 'data-slot': 'popover-trigger' },
  hostDirectives: [
    {
      directive: BrnPopoverTrigger,
      inputs: ['id', 'brnPopoverTriggerFor: hlmPopoverTriggerFor', 'type'],
    },
  ],
  selector: 'button[hlmPopoverTrigger],button[hlmPopoverTriggerFor]',
})
export class HlmPopoverTrigger {}

export const HlmPopoverImports = [
  HlmPopover,
  HlmPopoverContent,
  HlmPopoverPortal,
  HlmPopoverTrigger,
] as const;
