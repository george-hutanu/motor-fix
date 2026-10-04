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
import { I18n, TranslatePipe } from '@motor-fix/i18n';

export const HEALTH = makeStateKey<HealthReadyDto | null>('health');

// A 503 from the ready check still carries the report, so it is shown, not
// treated as "unknown".
const report = (error: unknown) =>
  error instanceof HttpErrorResponse && error.error?.checks
    ? (error.error as HealthReadyDto)
    : null;

@Component({
  imports: [TranslatePipe],
  selector: 'mf-root',
  template: `
    <h1>{{ 'shell.brand' | t }}</h1>
    <p>{{ health()?.version ?? ('shell.version.unknown' | t) }}</p>
    <p>{{ 'shell.health.status' | t: checks() }}</p>
  `,
})
export class App {
  private readonly state = inject(TransferState);
  protected readonly health = signal(this.state.get(HEALTH, null));
  private readonly i18n = inject(I18n);
  protected readonly checks = computed(() => {
    const checks = this.health()?.checks;
    const unknown = this.i18n.t('shell.health.unknown');
    return {
      postgres: checks?.postgres ?? unknown,
      redis: checks?.redis ?? unknown,
    };
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
