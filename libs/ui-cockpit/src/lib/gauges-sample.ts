import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { HlmButton } from './helm/button';
import { Lamp } from './lamp';
import { Odometer } from './odometer';
import { RatingDial } from './rating-dial';
import { REDUCED_MOTION } from './reduced-motion';

// Sample estimates in bani: data, not interface text.
const ESTIMATES = [
  [125000, 160000],
  [140000, 180000],
] as const;
const RATINGS = [4.8, 4.2] as const;

@Component({
  imports: [HlmButton, Lamp, Odometer, RatingDial, TranslatePipe],
  selector: 'mf-cockpit-gauges-sample',
  styles: `
    :host {
      display: block;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-space-4);
    }
    .stack {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-space-5);
    }
    .mf-live {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-space-2);
    }
    .mf-live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mf-red);
    }
    .dial {
      flex: 1 1 200px;
      max-width: 240px;
    }
  `,
  template: `
    <div class="stack">
      <div class="row">
        <mf-lamp state="green" [label]="'cockpit.gauges.lampGreen' | t" />
        <mf-lamp state="red" [label]="'cockpit.gauges.lampRed' | t" />
        <mf-lamp state="amber" pulse [label]="'cockpit.gauges.lampAmber' | t" />
        <mf-lamp state="grey" [label]="'cockpit.gauges.lampGrey' | t" />
        <span class="mf-label mf-live">
          <span class="mf-live-dot mf-blink" aria-hidden="true"></span>
          {{ 'cockpit.gauges.live' | t }}
        </span>
      </div>
      <div class="row">
        <div class="dial"><mf-rating-dial [value]="rating()" /></div>
        <div class="dial"><mf-rating-dial [value]="null" /></div>
        <mf-rating-dial size="small" [value]="rating()" />
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
      @if (reduced()) {
        <p data-motion="reduced">{{ 'cockpit.gauges.motionReduced' | t }}</p>
      } @else {
        <p data-motion="full">{{ 'cockpit.gauges.motionFull' | t }}</p>
      }
    </div>
  `,
})
export class CockpitGaugesSample {
  private readonly shown = signal(0);
  protected readonly estimate = computed(() => ESTIMATES[this.shown()]);
  protected readonly rating = computed(() => RATINGS[this.shown()]);
  protected readonly reduced = inject(REDUCED_MOTION);

  protected swap() {
    this.shown.update((i) => 1 - i);
  }
}
