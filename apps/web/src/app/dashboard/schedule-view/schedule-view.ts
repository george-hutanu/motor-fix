import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { LiftSchedule } from '../lift-schedule/lift-schedule';

// Programări: today's lift schedule while the garage schedules lifts; the
// line of what will appear here otherwise.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiftSchedule, TranslatePipe],
  selector: 'mf-schedule-view',
  styleUrl: './schedule-view.css',
  templateUrl: './schedule-view.html',
})
export class ScheduleView {}
