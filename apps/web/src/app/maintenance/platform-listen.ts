import {
  ApplicationRef,
  effect,
  type Injector,
  signal,
  untracked,
} from '@angular/core';
import { filter, merge } from 'rxjs';

import type { PlatformStatus } from './platform-status';
import { Live } from '../dashboard/live';
import { PublicLive } from '../public/live';

const RULE = 'maintenance_mode';
const CHANGED = ['platform_rule.changed'] as const;

// Waited after the page settles, and after the last download ended, before a
// tab with no signed-in stream opens the public one: a stream that never ends,
// opened while a map still fetches its tiles, keeps the page from ever counting
// as loaded. The re-read on opening catches what was missed.
const QUIET_FOR = 2_000;

// Calls done once no download has ended for QUIET_FOR.
function whenQuiet(done: () => void): void {
  let timer: ReturnType<typeof setTimeout>;
  let observer: PerformanceObserver | null = null;
  const wait = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      observer?.disconnect();
      done();
    }, QUIET_FOR);
  };
  if (typeof PerformanceObserver !== 'undefined') {
    observer = new PerformanceObserver(wait);
    observer.observe({ type: 'resource' });
  }
  wait();
}

// Re-reads the status on every change of the rule heard on either live stream
// and whenever a stream opens again; holds the public stream while the
// signed-in one is closed. Loaded apart, in the browser only, so the streams
// stay out of the first download.
export function listen(status: PlatformStatus, injector: Injector): void {
  const live = injector.get(Live);
  const publicLive = injector.get(PublicLive);
  merge(live.on(CHANGED), publicLive.on(CHANGED))
    .pipe(filter((m) => m.id === RULE))
    .subscribe(() => void status.read());
  merge(live.resync, publicLive.resync).subscribe(() => void status.read());

  const settled = signal(false);
  void injector
    .get(ApplicationRef)
    .whenStable()
    .then(() => whenQuiet(() => settled.set(true)));
  let leave: (() => void) | null = null;
  effect(
    () => {
      const hold = settled() && live.state() === 'closed';
      untracked(() => {
        if (hold && !leave) leave = publicLive.register({});
        if (!hold && leave) {
          leave();
          leave = null;
        }
      });
    },
    { injector },
  );
}
