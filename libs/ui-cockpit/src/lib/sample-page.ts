import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Drawer } from 'primeng/drawer';
import { InputText } from 'primeng/inputtext';
import { Popover } from 'primeng/popover';
import { TableModule } from 'primeng/table';
import { Tab, TabList, Tabs } from 'primeng/tabs';
import { Toast } from 'primeng/toast';
import { ToggleSwitch } from 'primeng/toggleswitch';

import { Panel } from './panel';
import { SAMPLE_GARAGES, SAMPLE_TEXT } from './sample-text';

@Component({
  imports: [
    Button,
    Dialog,
    Drawer,
    FormsModule,
    InputText,
    Panel,
    Popover,
    Tab,
    TabList,
    TableModule,
    Tabs,
    Toast,
    ToggleSwitch,
  ],
  providers: [MessageService],
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
        <p-button [label]="text.primary" />
        <p-button [label]="text.secondary" severity="secondary" />
      </div>

      <div class="field">
        <label for="car-brand">{{ text.inputLabel }}</label>
        <input pInputText id="car-brand" [(ngModel)]="brand" />
      </div>

      <div class="row">
        <p-toggleswitch inputId="open-now" [(ngModel)]="openNow" />
        <label for="open-now">{{ text.toggleLabel }}</label>
      </div>

      <p-tabs value="all">
        <p-tablist>
          <p-tab value="all">{{ text.tabAll }}</p-tab>
          <p-tab value="open">{{ text.tabOpen }}</p-tab>
          <p-tab value="reviews">{{ text.tabReviews }}</p-tab>
        </p-tablist>
      </p-tabs>

      <mf-panel [title]="text.panelTitle">
        <p-table [value]="garages">
          <ng-template #header>
            <tr>
              <th>{{ text.tableGarage }}</th>
              <th>{{ text.tableArea }}</th>
              <th>{{ text.tableRating }}</th>
            </tr>
          </ng-template>
          <ng-template #body let-garage>
            <tr>
              <td>{{ garage.name }}</td>
              <td>{{ garage.area }}</td>
              <td>{{ garage.rating }}</td>
            </tr>
          </ng-template>
        </p-table>
      </mf-panel>

      <div class="row">
        <p-button
          [label]="text.openDialog"
          severity="secondary"
          (onClick)="dialogOpen.set(true)"
        />
        <p-button
          [label]="text.openDrawer"
          severity="secondary"
          (onClick)="drawerOpen.set(true)"
        />
        <p-button
          [label]="text.showToast"
          severity="secondary"
          (onClick)="showToast()"
        />
        <p-button
          [label]="text.openPopover"
          severity="secondary"
          (onClick)="popover.toggle($event)"
        />
      </div>

      <p-dialog [header]="text.dialogTitle" [modal]="true" [(visible)]="dialogOpen">
        <p>{{ text.dialogBody }}</p>
      </p-dialog>
      <p-drawer [header]="text.drawerTitle" [(visible)]="drawerOpen">
        <p>{{ text.drawerBody }}</p>
      </p-drawer>
      <p-popover #popover>
        <p>{{ text.popoverBody }}</p>
      </p-popover>
      <p-toast />
    </main>
  `,
})
export class CockpitSamplePage {
  private readonly messages = inject(MessageService);
  protected readonly text = SAMPLE_TEXT;
  protected readonly garages = SAMPLE_GARAGES;
  protected readonly brand = signal('');
  protected readonly openNow = signal(true);
  protected readonly dialogOpen = signal(false);
  protected readonly drawerOpen = signal(false);

  protected showToast() {
    this.messages.add({
      detail: this.text.toastDetail,
      severity: 'success',
      summary: this.text.toastSummary,
    });
  }
}
