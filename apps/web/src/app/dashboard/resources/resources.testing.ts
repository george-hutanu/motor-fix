import { type Provider, signal } from '@angular/core';
import type { MeDto } from '@motor-fix/data-access';

import { fakeLive } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

// What Resources reads, for a view test that needs no more of the session: a
// driver signed in, and a live stream that sends nothing.
export function heldForDriver(): Provider[] {
  const me = signal({ id: 'account-1', role: 'driver' } as MeDto);
  return [
    { provide: Session, useValue: { current: me, shown: me } },
    { provide: Live, useValue: fakeLive() },
  ];
}
