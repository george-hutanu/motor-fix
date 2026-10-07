import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AdminService,
  type PlatformRuleDto,
  type PlatformRulesDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmSwitch } from '@motor-fix/ui-cockpit';
import { debounceTime, filter } from 'rxjs';

import { Live } from './live';

// The lines the block shows, in order. The skip_* rules read inverted: the
// switch is on while the check is required, and production never skips it.
const LINES = [
  { inverted: true, key: 'skip_rar_check' },
  { inverted: false, key: 'reviews_only_after_confirmed_job' },
  { inverted: true, key: 'skip_manual_approval' },
  { inverted: false, key: 'maintenance_mode' },
] as const;

type Line = (typeof LINES)[number];

// The admin's Setări: the platform rules, each saved as it is switched.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-platform-rules',
  styles: `
    :host { display: block; }
    section { display: flex; flex-direction: column; gap: var(--mf-space-3); margin: var(--mf-space-4); padding: var(--mf-space-4); border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-md, 12px); min-width: 0; }
    h2, p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    li { display: flex; align-items: center; justify-content: space-between; gap: var(--mf-space-3); padding: var(--mf-space-3) 0; border-top: 1px solid var(--mf-line); min-width: 0; }
    .name { display: flex; flex-direction: column; gap: var(--mf-space-1); min-width: 0; }
    .hint { color: var(--mf-ink-muted); font-size: 0.875rem; }
    .tag { align-self: flex-start; font-size: 0.75rem; padding: 0 var(--mf-space-2); border: 1px solid var(--mf-line-strong); border-radius: 999px; }
    hlm-switch { flex-shrink: 0; }
    .skeleton { height: 44px; border-radius: var(--mf-radius-sm, 8px); background: var(--mf-line); }
    button[hlmBtn] { width: 100%; white-space: normal; }
    @media (min-width: 390px) { button[hlmBtn] { width: auto; align-self: flex-start; } }
  `,
  template: `
    <section [attr.aria-busy]="list() === undefined && !failed()">
      <h2>{{ 'admin.platformRules.title' | t }}</h2>
      <p class="hint">{{ 'admin.platformRules.line' | t }}</p>
      @if (list(); as rules) {
        <ul>
          @for (line of lines; track line.key) {
            <li>
              <div class="name">
                <span>{{ name(line) | t }}</span>
                <span class="hint">{{ meaning(line) | t }}</span>
                @if (line.inverted) {
                  <span class="tag">{{ tag(rules) | t }}</span>
                }
              </div>
              @if (rule(rules, line); as r) {
                <hlm-switch
                  [checked]="isOn(line, r)"
                  [disabled]="pending().has(line.key)"
                  [aria-label]="name(line) | t"
                  (checkedChange)="toggle(line, r)"
                />
              }
            </li>
          }
        </ul>
        @if (error(); as key) {
          <p role="alert">{{ key | t }}</p>
        }
      } @else if (failed()) {
        <p role="alert">{{ 'admin.platformRules.loadFailed' | t }}</p>
        <button hlmBtn variant="secondary" type="button" (click)="load()">
          {{ 'admin.platformRules.retry' | t }}
        </button>
      } @else {
        @for (line of lines; track line.key) {
          <div class="skeleton" aria-hidden="true"></div>
        }
      }
    </section>
  `,
})
export class PlatformRules implements OnInit {
  private readonly api = inject(AdminService);
  private readonly live = inject(Live);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly lines = LINES;
  protected readonly list = signal<PlatformRulesDto | undefined>(undefined);
  protected readonly failed = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<ReadonlySet<string>>(new Set());

  constructor() {
    void inject(I18n).enter('admin');
  }

  ngOnInit() {
    this.live.events
      .pipe(filter((message) => message.kind === 'platform_rule.changed'))
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    void this.load();
  }

  // A failed re-read keeps the rules on screen; only a first read shows the error.
  protected async load() {
    this.failed.set(false);
    try {
      this.list.set(await this.api.platformRulesControllerList());
      return true;
    } catch {
      if (this.list() === undefined) this.failed.set(true);
      return false;
    }
  }

  protected rule(rules: PlatformRulesDto, line: Line) {
    if (line.inverted && rules.production) return undefined;
    return rules.rules.find((r) => r.key === line.key);
  }

  protected isOn(line: Line, rule: PlatformRuleDto) {
    return line.inverted ? rule.value === false : rule.value === true;
  }

  protected name(line: Line) {
    return `admin.platformRules.rule.${line.key}.name`;
  }

  protected tag(rules: PlatformRulesDto) {
    return rules.production
      ? 'admin.platformRules.alwaysOn'
      : 'admin.platformRules.testOnly';
  }

  protected meaning(line: Line) {
    return `admin.platformRules.rule.${line.key}.meaning`;
  }

  protected async toggle(line: Line, rule: PlatformRuleDto) {
    const { key } = line;
    if (this.pending().has(key)) return;
    const seen = rule.value;
    const value = !seen;
    this.error.set(null);
    this.mark(key, true);
    this.set(key, value);
    try {
      await this.api.platformRulesControllerChange({
        body: { seen, value },
        key,
      });
    } catch (failure) {
      await this.refused(key, seen, failure);
    } finally {
      this.mark(key, false);
    }
  }

  // A stale value re-reads the list; any other refusal, or a stale value whose
  // re-read fails, puts the switch back.
  private async refused(
    key: string,
    seen: PlatformRuleDto['value'],
    failure: unknown,
  ) {
    const code =
      failure instanceof HttpErrorResponse ? failure.error?.code : undefined;
    if (code === 'stale_value' && (await this.load())) return;
    this.set(key, seen);
    this.error.set(
      code === 'two_admins_required'
        ? 'admin.platformRules.twoAdmins'
        : 'admin.platformRules.saveFailed',
    );
  }

  private mark(key: string, busy: boolean) {
    this.pending.update((keys) => {
      const next = new Set(keys);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private set(key: string, value: PlatformRuleDto['value']) {
    this.list.update(
      (list) =>
        list && {
          ...list,
          rules: list.rules.map((r) => (r.key === key ? { ...r, value } : r)),
        },
    );
  }
}
