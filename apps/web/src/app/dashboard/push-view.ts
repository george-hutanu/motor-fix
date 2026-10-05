import { Component } from '@angular/core';

import { PushPanel } from './push-panel';
import { View } from './view';

// A view whose epic has not built its body yet, with this device's push panel.
@Component({
  imports: [PushPanel, View],
  selector: 'mf-dashboard-push-view',
  template: `<mf-push-panel /><mf-dashboard-view />`,
})
export class PushView {}
