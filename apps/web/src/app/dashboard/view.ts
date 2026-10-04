import { Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

// Every view's body until the epic that owns the view builds it.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-dashboard-view',
  template: `<p>{{ 'shell.frame.empty' | t }}</p>`,
})
export class View {}
