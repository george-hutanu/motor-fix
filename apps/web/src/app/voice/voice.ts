import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

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

// Voices whose benefits headline has no second line.
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

// The copy voice of the visit. The script in the page head picks it before
// the first paint and marks <html data-voice>; it is read once here, so a
// voice another tab takes later never mixes into this one. The server's page
// carries no mark, so it renders voice 1.
@Injectable({ providedIn: 'root' })
export class Voice {
  readonly voice: number;
  // The keys of this visit's voice, by slot.
  readonly copy: Readonly<Record<Slot, string>>;
  // The benefits headline's second line, or null for a one-line voice.
  readonly feat2: string | null;

  constructor() {
    const mark = inject(DOCUMENT).documentElement.dataset['voice'] ?? '';
    this.voice = /^[1-5]$/.test(mark) ? Number(mark) : 1;
    this.copy = keysOf(this.voice);
    this.feat2 = this.key('feat2');
  }

  key(slot: Slot): string;
  key(slot: 'feat2'): string | null;
  key(slot: Slot | 'feat2'): string | null {
    if (slot === 'review') return `driver.review.voices.v${this.voice}`;
    if (slot === 'feat2' && ONE_LINE.has(this.voice)) return null;
    return `public.voice.v${this.voice}.${slot}`;
  }
}
