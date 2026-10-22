import { isPlatformBrowser } from '@angular/common';
import {
  effect,
  Injectable,
  inject,
  PLATFORM_ID,
  provideAppInitializer,
} from '@angular/core';

import { Consent } from '../../consent/consent';
import { Voice } from '../voice';

// A Home load that took the visit's voice is told to the analytics once, as
// soon as consent allows it: at boot, or when the visitor accepts later, with
// the voice in force at that moment.
@Injectable({ providedIn: 'root' })
export class HomeVisit {
  private readonly consent = inject(Consent);
  private readonly voice = inject(Voice);
  private sent = false;

  constructor() {
    effect(() => {
      if (this.sent || !this.voice.taken || !this.consent.granted()) return;
      this.sent = true;
      this.consent.track('home_visit', { voice: this.voice.voice });
    });
  }
}

export const provideHomeVisit = () =>
  provideAppInitializer(() => {
    if (isPlatformBrowser(inject(PLATFORM_ID))) inject(HomeVisit);
  });
