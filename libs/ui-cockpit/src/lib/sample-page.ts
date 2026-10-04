import { Component, inject, PendingTasks, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import { CockpitChartsSample } from './charts-sample';
import { CockpitGaugesSample } from './gauges-sample';
import { HlmButton } from './helm/button';
import { HlmDialogImports } from './helm/dialog';
import { HlmInput } from './helm/input';
import { HlmLabel } from './helm/label';
import { HlmPopoverImports } from './helm/popover';
import { HlmSheetImports } from './helm/sheet';
import { HlmSwitch } from './helm/switch';
import { HlmTableImports } from './helm/table';
import { HlmTabsImports } from './helm/tabs';
import { HlmToaster, toast } from './helm/toaster';
import { Panel } from './panel';
import { SAMPLE_GARAGES } from './sample-text';

@Component({
  imports: [
    CockpitGaugesSample,
    FormsModule,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmLabel,
    HlmPopoverImports,
    HlmSheetImports,
    HlmSwitch,
    HlmTableImports,
    HlmTabsImports,
    HlmToaster,
    Panel,
    TranslatePipe,
    CockpitChartsSample,
  ],
  selector: 'mf-cockpit-sample-page',
  styles: `
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-space-6);
      max-width: 960px;
      margin: 0 auto;
      padding: var(--mf-space-6) var(--mf-space-4);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-space-3);
    }
    .field {
      display: grid;
      gap: var(--mf-space-2);
    }
  `,
  template: `
    <main>
      <h1>{{ 'cockpit.heading' | t }}</h1>
      <p>{{ 'cockpit.intro' | t }}</p>

      <p class="mf-label">{{ 'cockpit.romanian' | t }}</p>
      <p>{{ 'cockpit.romanian' | t }}</p>

      <div class="row">
        <button hlmBtn>{{ 'cockpit.primary' | t }}</button>
        <button hlmBtn variant="secondary">{{ 'cockpit.secondary' | t }}</button>
      </div>

      <div class="field">
        <label hlmLabel for="car-brand">{{ 'cockpit.inputLabel' | t }}</label>
        <input hlmInput id="car-brand" [(ngModel)]="brand" />
      </div>

      <div class="row">
        <hlm-switch inputId="open-now" [(ngModel)]="openNow" />
        <label hlmLabel for="open-now">{{ 'cockpit.toggleLabel' | t }}</label>
      </div>

      <div hlmTabs tab="all">
        <div hlmTabsList>
          <button hlmTabsTrigger="all">{{ 'cockpit.tabAll' | t }}</button>
          <button hlmTabsTrigger="open">{{ 'cockpit.tabOpen' | t }}</button>
          <button hlmTabsTrigger="reviews">{{ 'cockpit.tabReviews' | t }}</button>
        </div>
        <p hlmTabsContent="all">{{ 'cockpit.tabAllBody' | t }}</p>
        <p hlmTabsContent="open">{{ 'cockpit.tabOpenBody' | t }}</p>
        <p hlmTabsContent="reviews">{{ 'cockpit.tabReviewsBody' | t }}</p>
      </div>

      <mf-panel [heading]="'cockpit.panelTitle' | t">
        <div hlmTableContainer>
          <table hlmTable>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh column="main">{{ 'cockpit.tableGarage' | t }}</th>
                <th hlmTh>{{ 'cockpit.tableArea' | t }}</th>
                <th hlmTh column="key">{{ 'cockpit.tableRating' | t }}</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (garage of garages; track garage.name) {
                <tr hlmTr>
                  <td hlmTd column="main">{{ garage.name }}</td>
                  <td hlmTd>{{ garage.area }}</td>
                  <td hlmTd column="key">{{ garage.rating }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </mf-panel>

      <mf-cockpit-gauges-sample />

      <div class="row">
        <hlm-dialog>
          <button hlmBtn hlmDialogTrigger variant="secondary">
            {{ 'cockpit.openDialog' | t }}
          </button>
          <hlm-dialog-content *hlmDialogPortal="let ctx" [closeLabel]="'cockpit.close' | t">
            <hlm-dialog-header>
              <h2 hlmDialogTitle class="mf-label">{{ 'cockpit.dialogTitle' | t }}</h2>
            </hlm-dialog-header>
            <p>{{ 'cockpit.dialogBody' | t }}</p>
          </hlm-dialog-content>
        </hlm-dialog>

        <hlm-sheet side="right">
          <button hlmBtn hlmSheetTrigger variant="secondary">
            {{ 'cockpit.openDrawer' | t }}
          </button>
          <hlm-sheet-content *hlmSheetPortal="let ctx" [closeLabel]="'cockpit.close' | t">
            <hlm-sheet-header>
              <h2 hlmSheetTitle class="mf-label">{{ 'cockpit.drawerTitle' | t }}</h2>
            </hlm-sheet-header>
            <p>{{ 'cockpit.drawerBody' | t }}</p>
          </hlm-sheet-content>
        </hlm-sheet>

        <button hlmBtn variant="secondary" (click)="showToast()">
          {{ 'cockpit.showToast' | t }}
        </button>

        <hlm-popover>
          <button hlmBtn hlmPopoverTrigger variant="secondary">
            {{ 'cockpit.openPopover' | t }}
          </button>
          <hlm-popover-content *hlmPopoverPortal="let ctx">
            <p>{{ 'cockpit.popoverBody' | t }}</p>
          </hlm-popover-content>
        </hlm-popover>
      </div>

      <mf-cockpit-charts-sample />

      <hlm-toaster />
    </main>
  `,
})
export class CockpitSamplePage {
  private readonly i18n = inject(I18n);
  protected readonly garages = SAMPLE_GARAGES;
  protected readonly brand = signal('');
  protected readonly openNow = signal(true);

  protected showToast() {
    toast(this.i18n.t('cockpit.toastSummary'), {
      description: this.i18n.t('cockpit.toastDetail'),
    });
  }

  constructor() {
    // Holds the server render until the texts are in, so no raw key ships.
    void inject(PendingTasks).run(() => this.i18n.enter('cockpit'));
  }
}
