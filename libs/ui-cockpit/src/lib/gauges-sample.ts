import { Component, computed, signal } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { HlmButton } from './helm/button';
import { Lamp } from './lamp';
import { Odometer } from './odometer';
import { Panel } from './panel';
import { RatingDial } from './rating-dial';

// Sample estimates in bani: data, not interface text.
const ESTIMATES = [
  [125000, 160000],
  [140000, 180000],
] as const;

@Component({
  imports: [HlmButton, Lamp, Odometer, Panel, RatingDial, TranslatePipe],
  selector: 'mf-cockpit-gauges-sample',
  styles: `
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-space-4);
    }
    .stack {
      display: grid;
      gap: var(--mf-space-5);
    }
    .dial {
      flex: 1 1 200px;
      max-width: 240px;
    }
  `,
  template: `
    <mf-panel [heading]="'cockpit.gauges.title' | t">
      <div class="stack">
        <div class="row">
          <mf-lamp state="green" [label]="'cockpit.gauges.lampGreen' | t" />
          <mf-lamp state="red" [label]="'cockpit.gauges.lampRed' | t" />
          <mf-lamp state="amber" pulse [label]="'cockpit.gauges.lampAmber' | t" />
          <mf-lamp state="grey" [label]="'cockpit.gauges.lampGrey' | t" />
        </div>
        <div class="row">
          <div class="dial"><mf-rating-dial [value]="4.8" /></div>
          <div class="dial"><mf-rating-dial [value]="null" /></div>
          <mf-rating-dial size="small" [value]="4.8" />
          <mf-rating-dial size="small" [value]="null" />
        </div>
        <div class="row">
          <mf-odometer [from]="140050" />
          <mf-odometer [from]="estimate()[0]" [to]="estimate()[1]" />
          <mf-odometer [from]="null" />
          <button hlmBtn variant="secondary" (click)="swap()">
            {{ 'cockpit.gauges.swap' | t }}
          </button>
        </div>
      </div>
    </mf-panel>
  `,
})
export class CockpitGaugesSample {
  private readonly shown = signal(0);
  protected readonly estimate = computed(() => ESTIMATES[this.shown()]);

  protected swap() {
    this.shown.update((i) => 1 - i);
  }
}
