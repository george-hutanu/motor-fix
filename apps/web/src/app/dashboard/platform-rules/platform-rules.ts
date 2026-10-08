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
  type PlatformRuleChangeDto,
  type PlatformRuleChangesDto,
  type PlatformRuleDto,
  type PlatformRulesDto,
} from '@motor-fix/data-access';
import { formatClock, formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, HlmSwitch } from '@motor-fix/ui-cockpit';
import { debounceTime, filter } from 'rxjs';

import { RuleOffRequest } from './rule-off-request/rule-off-request';
import { Live } from '../live';

// The lines the block shows, in order. The skip_* rules read inverted: the
// switch is on while the check is required, and production never skips it.
const LINES = [
  { inverted: true, key: 'skip_rar_check' },
  { inverted: false, key: 'reviews_only_after_confirmed_job' },
  { inverted: true, key: 'skip_manual_approval' },
  { inverted: false, key: 'maintenance_mode' },
] as const;

type Line = (typeof LINES)[number];

// The one rule that needs a second admin to switch off; its requests show
// under its line.
const TWO_ADMINS = 'reviews_only_after_confirmed_job';

const LIVE_KINDS = new Set([
  'platform_rule.changed',
  'platform_rule.change_requested',
  'platform_rule.change_decided',
]);

type Step = 'approve' | 'refuse' | 'cancel';

// The admin's Setări: the platform rules, each saved as it is switched.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-platform-rules',
  styleUrl: './platform-rules.css',
  templateUrl: './platform-rules.html',
})
export class PlatformRules implements OnInit {
  private readonly api = inject(AdminService);
  private readonly live = inject(Live);
  private readonly destroyRef = inject(DestroyRef);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);

  protected readonly lines = LINES;
  protected readonly list = signal<PlatformRulesDto | undefined>(undefined);
  protected readonly failed = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<ReadonlySet<string>>(new Set());
  protected readonly changes = signal<PlatformRuleChangesDto>({
    decided: [],
    waiting: null,
  });
  protected readonly deciding = signal(false);
  // A rule whose request dialog is open: it takes no second toggle, but its
  // switch stays enabled so the dialog can give the focus back to it.
  private readonly asking = new Set<string>();
  protected readonly twoAdmins = TWO_ADMINS;

  constructor() {
    void this.i18n.enter('admin');
  }

  ngOnInit() {
    this.live.events
      .pipe(filter((message) => LIVE_KINDS.has(message.kind)))
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    void this.load();
  }

  // The rules and the requests are read together. A failed re-read keeps
  // them on screen; only a first read shows the error.
  protected async load() {
    this.failed.set(false);
    try {
      const [rules, changes] = await Promise.all([
        this.api.platformRulesControllerList(),
        this.api.platformRuleChangesControllerList({ key: TWO_ADMINS }),
      ]);
      this.list.set(rules);
      this.changes.set(changes);
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

  protected locked(line: Line) {
    return (
      this.pending().has(line.key) ||
      (line.key === TWO_ADMINS && this.changes().waiting !== null)
    );
  }

  protected when(at: string | null) {
    return `${formatDay(at, this.i18n.language())}, ${formatClock(at)}`;
  }

  protected decidedBy(change: PlatformRuleChangeDto) {
    return `admin.platformRules.decided.${change.status}`;
  }

  protected async toggle(line: Line, rule: PlatformRuleDto) {
    const { key } = line;
    if (this.pending().has(key) || this.asking.has(key)) return;
    const seen = rule.value;
    const value = !seen;
    if (rule.requiresTwoAdmins && value === false) {
      await this.ask(key, seen);
      return;
    }
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

  // Switching off a rule that needs a second admin asks for it instead; the
  // switch goes back on, and a sent request shows as waiting.
  private async ask(key: string, seen: PlatformRuleDto['value']) {
    this.error.set(null);
    this.asking.add(key);
    this.set(key, false);
    try {
      const sent = await this.overlays.open(RuleOffRequest, {
        data: { key },
        shape: 'dialog',
        title: 'admin.platformRules.request.title',
      });
      if (sent !== 'cancelled') await this.load();
    } finally {
      this.set(key, seen);
      this.asking.delete(key);
    }
  }

  // Approve, refuse or withdraw the waiting request. Another admin deciding
  // first is no error: the re-read shows what they chose.
  protected async decide(step: Step, id: string) {
    if (this.deciding()) return;
    this.deciding.set(true);
    this.error.set(null);
    try {
      await this.send(step, id);
    } catch (failure) {
      const code =
        failure instanceof HttpErrorResponse ? failure.error?.code : undefined;
      if (code !== 'already_decided') {
        this.error.set('admin.platformRules.saveFailed');
      }
    } finally {
      await this.load();
      this.deciding.set(false);
    }
  }

  private send(step: Step, id: string) {
    if (step === 'approve') {
      return this.api.platformRuleChangesControllerApprove({ id });
    }
    if (step === 'refuse') {
      return this.api.platformRuleChangesControllerRefuse({ id });
    }
    return this.api.platformRuleChangesControllerCancel({ id });
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
