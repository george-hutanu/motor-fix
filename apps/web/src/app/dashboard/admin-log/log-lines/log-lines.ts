import { Component, input } from '@angular/core';
import { Lamp } from '@motor-fix/ui-cockpit';

import type { LineView } from '../admin-log.line';

@Component({
  imports: [Lamp],
  selector: 'mf-log-lines',
  styleUrl: './log-lines.css',
  templateUrl: './log-lines.html',
})
export class LogLines {
  readonly lines = input.required<readonly LineView[]>();
}
