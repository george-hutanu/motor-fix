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

// Voices whose benefits headline has no second line; the translation files
// carry no feat2 for them (voice.spec.ts holds the two together). Voice 3's
// headline shows sample figures until the live counts of ST-7 replace them.
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
    // getAttribute, not dataset: the server's document has no dataset.
    const mark =
      inject(DOCUMENT).documentElement.getAttribute('data-voice') ?? '';
    this.voice = /^[1-5]$/.test(mark) ? Number(mark) : 1;
    this.copy = keysOf(this.voice);
    this.feat2 = ONE_LINE.has(this.voice)
      ? null
      : `public.voice.v${this.voice}.feat2`;
  }

  key(slot: Slot): string;
  key(slot: 'feat2'): string | null;
  key(slot: Slot | 'feat2'): string | null {
    return slot === 'feat2' ? this.feat2 : this.copy[slot];
  }
}
