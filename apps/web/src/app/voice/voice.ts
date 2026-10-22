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
import type { PublicCopyVoicesDto } from '@motor-fix/data-access';
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
// carry no feat2 for them (voice.spec.ts holds the two together).
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

// A brand's own hyphen never breaks the line ("Mercedes-Benz", "BMW-ul"): the
// name goes in as an unbreaking hyphen, so no line ends inside it.
export const unbroken = (name: string) => name.replace(/-/g, '\u2011');

type Head = { mfCopyVoice?: (settings: PublicCopyVoicesDto) => number };

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
  // The document loaded on Home, as the page head saw it.
  readonly fromHome: boolean;
  // This Home load took a new voice for the visit, rather than keeping one.
  readonly taken: boolean;

  constructor() {
    // getAttribute, not dataset: the server's document has no dataset.
    const html = this.document.documentElement;
    const mark = html.getAttribute('data-voice') ?? '';
    this.n.set(/^[1-5]$/.test(mark) ? Number(mark) : 1);
    this.fromHome = html.getAttribute('data-home') !== null;
    this.taken = this.fromHome && html.getAttribute('data-voice-new') !== null;
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

  // The page head picks the voice, and stores it, as it does at the start of
  // a visit; a page whose head script did not run keeps its voice.
  apply(settings: PublicCopyVoicesDto): void {
    const head = (this.document.defaultView as Head | null)?.mfCopyVoice;
    if (head) this.n.set(head(settings));
  }
}

// The settings read once at boot, in the browser only and without holding the
// first render; a cache may answer it.
export const provideVoiceRead = () =>
  provideAppInitializer(() => {
    if (isPlatformBrowser(inject(PLATFORM_ID))) void inject(Voice).read();
  });
