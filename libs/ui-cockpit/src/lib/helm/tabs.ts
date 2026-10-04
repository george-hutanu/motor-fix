import { Directive, input } from '@angular/core';
import {
  BrnTabs,
  BrnTabsContent,
  BrnTabsList,
  BrnTabsTrigger,
} from '@spartan-ng/brain/tabs';

@Directive({
  host: { class: 'spartan-tabs', 'data-slot': 'tabs' },
  hostDirectives: [
    {
      directive: BrnTabs,
      inputs: ['orientation', 'activationMode', 'brnTabs: tab'],
      outputs: ['tabActivated'],
    },
  ],
  selector: '[hlmTabs],hlm-tabs',
})
export class HlmTabs {
  readonly tab = input.required<string>();
}

@Directive({
  host: { class: 'spartan-tabs-list', 'data-slot': 'tabs-list' },
  hostDirectives: [BrnTabsList],
  selector: '[hlmTabsList],hlm-tabs-list',
})
export class HlmTabsList {}

@Directive({
  host: { class: 'spartan-tabs-trigger', 'data-slot': 'tabs-trigger' },
  hostDirectives: [
    {
      directive: BrnTabsTrigger,
      inputs: ['brnTabsTrigger: hlmTabsTrigger', 'disabled'],
    },
  ],
  selector: 'button[hlmTabsTrigger]',
})
export class HlmTabsTrigger {
  readonly triggerFor = input.required<string>({ alias: 'hlmTabsTrigger' });
}

@Directive({
  host: { class: 'spartan-tabs-content', 'data-slot': 'tabs-content' },
  hostDirectives: [
    { directive: BrnTabsContent, inputs: ['brnTabsContent: hlmTabsContent'] },
  ],
  selector: '[hlmTabsContent]',
})
export class HlmTabsContent {
  readonly contentFor = input.required<string>({ alias: 'hlmTabsContent' });
}

export const HlmTabsImports = [
  HlmTabs,
  HlmTabsList,
  HlmTabsTrigger,
  HlmTabsContent,
] as const;
