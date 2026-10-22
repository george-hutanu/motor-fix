import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AdminService,
  type CopyVoiceDto,
  type CopyVoicesDto,
} from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmSwitch } from '@motor-fix/ui-cockpit';
import { debounceTime, filter } from 'rxjs';

import { Live } from '../live';

type State = Pick<CopyVoiceDto, 'enabled' | 'pinned'>;

const PLACEHOLDERS = [1, 2, 3, 4, 5];

// The example line shows each voice's Home headline for one brand; voice 3's
// figures stay empty, as on Home before its answer arrives.
const BRAND = { brand: 'BMW', figures: '' };

// The refusals the section names; anything else reads as a failed save.
const ERRORS: Record<string, string> = {
  last_voice: 'admin.copyVoices.lastVoice',
  stale_value: 'admin.copyVoices.stale',
};

// The admin's Setări: which copy voices visitors may get, and the one pinned
// for everyone. Each change shows at once and goes back if it is refused.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-copy-voices',
  styleUrl: './copy-voices.css',
  templateUrl: './copy-voices.html',
})
export class CopyVoices implements OnInit {
  private readonly api = inject(AdminService);
  private readonly live = inject(Live);
  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(I18n);

  protected readonly placeholders = PLACEHOLDERS;
  protected readonly brand = BRAND;
  protected readonly list = signal<CopyVoicesDto | undefined>(undefined);
  protected readonly failed = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<number | null>(null);
  protected readonly pinned = computed(
    () => this.list()?.voices.find((v) => v.pinned)?.voice ?? null,
  );

  constructor() {
    // The example lines are the voices' Home headlines.
    void this.i18n.enter('admin');
    void this.i18n.enter('public');
  }

  ngOnInit() {
    this.live.events
      .pipe(
        filter(
          (m) => m.kind === 'platform_rule.changed' && m.id === 'copy_voices',
        ),
        debounceTime(300),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => void this.load());
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    void this.load();
  }

  // A failed re-read keeps the voices on screen; only a first read shows the
  // error.
  protected async load() {
    this.failed.set(false);
    try {
      this.list.set(await this.api.copyVoicesControllerList());
      return true;
    } catch {
      if (this.list() === undefined) this.failed.set(true);
      return false;
    }
  }

  protected name(v: CopyVoiceDto) {
    return `admin.copyVoices.name.v${v.voice}`;
  }

  protected example(v: CopyVoiceDto) {
    return `public.voice.v${v.voice}.headline`;
  }

  // What the voice brought in the last 30 days, in the language shown.
  protected counts(v: CopyVoiceDto) {
    const language = this.i18n.language();
    const plural = (key: string, value: number) =>
      this.i18n.t(`admin.copyVoices.${key}`, {
        count: value,
        n: formatNum(value, language),
      });
    return `${plural('requests', v.requests)} · ${plural('listings', v.listings)}`;
  }

  protected pinLabel(v: CopyVoiceDto) {
    return v.pinned ? 'admin.copyVoices.unpin' : 'admin.copyVoices.pin';
  }

  protected toggle(v: CopyVoiceDto) {
    return this.save(v, { enabled: !v.enabled, pinned: v.pinned });
  }

  protected pin(v: CopyVoiceDto) {
    return this.save(v, { enabled: v.enabled, pinned: !v.pinned });
  }

  // One save at a time: the controls wait while one is on its way.
  private async save(v: CopyVoiceDto, next: State) {
    const before = this.list();
    if (!before || this.pending() !== null) return;
    const seen = { enabled: v.enabled, pinned: v.pinned };
    this.error.set(null);
    this.pending.set(v.voice);
    this.list.set(shown(before, v.voice, next));
    try {
      this.list.set(
        await this.api.copyVoicesControllerChange({
          body: { ...next, seen },
          voice: String(v.voice),
        }),
      );
    } catch (failure) {
      await this.refused(before, failure);
    } finally {
      this.pending.set(null);
    }
  }

  // A stale change re-reads the voices; any other refusal, or a stale change
  // whose re-read fails, puts them back as they were.
  private async refused(before: CopyVoicesDto, failure: unknown) {
    const code =
      failure instanceof HttpErrorResponse ? failure.error?.code : undefined;
    this.error.set(ERRORS[code] ?? 'admin.copyVoices.saveFailed');
    const reread = code === 'stale_value' && (await this.load());
    if (!reread) this.list.set(before);
  }
}

// The voices with one changed; pinning it takes the pin off any other.
function shown(list: CopyVoicesDto, voice: number, next: State) {
  return {
    voices: list.voices.map((v) =>
      v.voice === voice
        ? { ...v, ...next }
        : { ...v, pinned: next.pinned ? false : v.pinned },
    ),
  };
}
