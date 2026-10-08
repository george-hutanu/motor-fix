import { Component } from '@angular/core';

import { PushPanel } from '../push-panel/push-panel';
import { View } from '../view/view';

// A view whose epic has not built its body yet, with this device's push panel.
@Component({
  imports: [PushPanel, View],
  selector: 'mf-dashboard-push-view',
  templateUrl: './push-view.html',
})
export class PushView {}
