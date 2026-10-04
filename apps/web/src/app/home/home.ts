import { isPlatformServer } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  inject,
  makeStateKey,
  PendingTasks,
  PLATFORM_ID,
  signal,
  TransferState,
} from '@angular/core';
import { HealthReadyDto, HealthService } from '@motor-fix/data-access';

export const HEALTH = makeStateKey<HealthReadyDto | null>('health');

// A 503 from the ready check still carries the report, so it is shown, not
// treated as "unknown".
const report = (error: unknown) =>
  error instanceof HttpErrorResponse && error.error?.checks
    ? (error.error as HealthReadyDto)
    : null;

@Component({
  selector: 'mf-home',
  template: `
    <h1>MotorFix</h1>
    <p>{{ health()?.version ?? 'version unknown' }}</p>
    <p>{{ status() }}</p>
  `,
})
export class Home {
  private readonly state = inject(TransferState);
  protected readonly health = signal(this.state.get(HEALTH, null));
  protected readonly status = computed(() => {
    const checks = this.health()?.checks;
    return `PostgreSQL: ${checks?.postgres ?? 'unknown'} · Redis: ${checks?.redis ?? 'unknown'}`;
  });

  constructor() {
    if (!isPlatformServer(inject(PLATFORM_ID))) return;
    const api = inject(HealthService);
    void inject(PendingTasks).run(async () => {
      const health = await api.healthControllerReady().catch(report);
      this.health.set(health);
      this.state.set(HEALTH, health);
    });
  }
}
