import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
import { SAMPLE_GARAGES, SAMPLE_TEXT } from './sample-text';

@Component({
  imports: [
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
  ],
  selector: 'mf-cockpit-sample-page',
  styles: `
    main {
      display: grid;
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
    .reading {
      font-family: var(--mf-font-body);
    }
  `,
  template: `
    <main>
      <h1>{{ text.heading }}</h1>
      <p>{{ text.intro }}</p>

      <p class="mf-label">{{ text.romanian }}</p>
      <p class="reading">{{ text.romanian }}</p>

      <div class="row">
        <button hlmBtn>{{ text.primary }}</button>
        <button hlmBtn variant="secondary">{{ text.secondary }}</button>
      </div>

      <div class="field">
        <label hlmLabel for="car-brand">{{ text.inputLabel }}</label>
        <input hlmInput id="car-brand" [(ngModel)]="brand" />
      </div>

      <div class="row">
        <hlm-switch inputId="open-now" [(ngModel)]="openNow" />
        <label hlmLabel for="open-now">{{ text.toggleLabel }}</label>
      </div>

      <div hlmTabs tab="all">
        <div hlmTabsList>
          <button hlmTabsTrigger="all">{{ text.tabAll }}</button>
          <button hlmTabsTrigger="open">{{ text.tabOpen }}</button>
          <button hlmTabsTrigger="reviews">{{ text.tabReviews }}</button>
        </div>
        <p hlmTabsContent="all">{{ text.tabAllBody }}</p>
        <p hlmTabsContent="open">{{ text.tabOpenBody }}</p>
        <p hlmTabsContent="reviews">{{ text.tabReviewsBody }}</p>
      </div>

      <mf-panel [title]="text.panelTitle">
        <div hlmTableContainer>
          <table hlmTable>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh>{{ text.tableGarage }}</th>
                <th hlmTh>{{ text.tableArea }}</th>
                <th hlmTh>{{ text.tableRating }}</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (garage of garages; track garage.name) {
                <tr hlmTr>
                  <td hlmTd>{{ garage.name }}</td>
                  <td hlmTd>{{ garage.area }}</td>
                  <td hlmTd>{{ garage.rating }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </mf-panel>

      <div class="row">
        <hlm-dialog>
          <button hlmBtn hlmDialogTrigger variant="secondary">
            {{ text.openDialog }}
          </button>
          <hlm-dialog-content *hlmDialogPortal="let ctx" [closeLabel]="text.close">
            <hlm-dialog-header>
              <h2 hlmDialogTitle class="mf-label">{{ text.dialogTitle }}</h2>
            </hlm-dialog-header>
            <p>{{ text.dialogBody }}</p>
          </hlm-dialog-content>
        </hlm-dialog>

        <hlm-sheet side="right">
          <button hlmBtn hlmSheetTrigger variant="secondary">
            {{ text.openDrawer }}
          </button>
          <hlm-sheet-content *hlmSheetPortal="let ctx" [closeLabel]="text.close">
            <hlm-sheet-header>
              <h2 hlmSheetTitle class="mf-label">{{ text.drawerTitle }}</h2>
            </hlm-sheet-header>
            <p>{{ text.drawerBody }}</p>
          </hlm-sheet-content>
        </hlm-sheet>

        <button hlmBtn variant="secondary" (click)="showToast()">
          {{ text.showToast }}
        </button>

        <hlm-popover>
          <button hlmBtn hlmPopoverTrigger variant="secondary">
            {{ text.openPopover }}
          </button>
          <hlm-popover-content *hlmPopoverPortal="let ctx">
            <p>{{ text.popoverBody }}</p>
          </hlm-popover-content>
        </hlm-popover>
      </div>

      <hlm-toaster />
    </main>
  `,
})
export class CockpitSamplePage {
  protected readonly text = SAMPLE_TEXT;
  protected readonly garages = SAMPLE_GARAGES;
  protected readonly brand = signal('');
  protected readonly openNow = signal(true);

  protected showToast() {
    toast(this.text.toastSummary, { description: this.text.toastDetail });
  }
}
