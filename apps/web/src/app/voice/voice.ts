import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  computed,
  Injectable,
  Injector,
  inject,
  PLATFORM_ID,
  provideAppInitializer,
  signal,
} from '@angular/core';
import { PlatformService } from '@motor-fix/data-access/services/platform.service';

export type Slot =
  | 'cta'
  | 'eyebrow'
  | 'feat'
  | 'garage'
  | 'headline'
  | 'list'
  | 'no'
  | 'noLabel'
  | 'parts'
  | 'review'
  | 'sub';

// Voices whose benefits headline has no second line; the translation files
// carry no feat2 for them (voice.spec.ts holds the two together). Voice 3's
// headline shows sample figures until the live counts replace them.
const ONE_LINE = new Set([3, 5]);

const SLOTS: readonly Slot[] = [
  'cta',
  'eyebrow',
  'feat',
  'garage',
  'headline',
  'list',
  'no',
  'noLabel',
  'parts',
  'review',
  'sub',
];

// The translation key of each slot in voice n; a template reads these as
// properties, so no key is typed into it as a string.
export const keysOf = (n: number): Readonly<Record<Slot, string>> =>
  Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      slot === 'review'
        ? `driver.review.voices.v${n}`
        : `public.voice.v${n}.${slot}`,
    ]),
  ) as Record<Slot, string>;

export interface CopyVoiceSettings {
  enabled: number[];
  pinned: number | null;
}

type Head = { mfCopyVoice?: (settings: CopyVoiceSettings) => number };

// The copy voice of the visit. The script in the page head picks it before
// the first paint and marks <html data-voice>; it is read once here, so a
// voice another tab takes later never mixes into this one. The server's page
// carries no mark, so it renders voice 1. It changes only when the admins
// switch it off: the settings read while the visit runs go back to the page
// head, which moves the visit to a voice that is on.
@Injectable({ providedIn: 'root' })
export class Voice {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly n = signal(1);
  private readonly keys = computed(() => keysOf(this.n()));
  // Only the newest read decides.
  private reads = 0;

  constructor() {
    // getAttribute, not dataset: the server's document has no dataset.
    const mark = this.document.documentElement.getAttribute('data-voice') ?? '';
    this.n.set(/^[1-5]$/.test(mark) ? Number(mark) : 1);
  }

  get voice(): number {
    return this.n();
  }

  // The keys of this visit's voice, by slot.
  get copy(): Readonly<Record<Slot, string>> {
    return this.keys();
  }

  // The benefits headline's second line, or null for a one-line voice.
  get feat2(): string | null {
    const n = this.n();
    return ONE_LINE.has(n) ? null : `public.voice.v${n}.feat2`;
  }

  key(slot: Slot): string {
    return this.copy[slot];
  }

  // `at` makes the read miss every cache, after a change or a stream reopen.
  async read(at?: string): Promise<void> {
    const read = ++this.reads;
    try {
      const settings = await this.injector
        .get(PlatformService)
        .publicCopyVoicesControllerSettings(at ? { at } : undefined);
      if (read === this.reads) this.apply(settings);
    } catch {
      // Unknown settings change nothing: keep the voice.
    }
  }

  apply(settings: CopyVoiceSettings): void {
    const head = (this.document.defaultView as Head | null)?.mfCopyVoice;
    this.n.set(head ? head(settings) : this.fallback(settings));
  }

  // Without the page head's script: the voice stays while it is on, else the
  // pinned voice or the first one on, for this page only.
  private fallback({ enabled, pinned }: CopyVoiceSettings): number {
    const n = this.n();
    if (enabled.includes(n) || enabled.length === 0) return n;
    const next = pinned ?? enabled[0];
    this.document.documentElement.setAttribute('data-voice', String(next));
    return next;
  }
}

// The settings read once at boot, in the browser only and without holding the
// first render; a cache may answer it.
export const provideVoiceRead = () =>
  provideAppInitializer(() => {
    if (isPlatformBrowser(inject(PLATFORM_ID))) void inject(Voice).read();
  });
