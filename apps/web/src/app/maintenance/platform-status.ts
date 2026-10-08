import { isPlatformBrowser } from '@angular/common';
import {
  ApplicationRef,
  computed,
  effect,
  Injectable,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { PlatformService } from '@motor-fix/data-access';
import { filter, merge } from 'rxjs';

import { Live } from '../dashboard/live';
import { Session } from '../dashboard/session';
import { PublicLive } from '../public/live';

const RULE = 'maintenance_mode';
const CHANGED = ['platform_rule.changed'] as const;

// Waited after the page settles before a tab with no signed-in stream opens
// the public one: a page that never goes quiet on the network would otherwise
// never count as loaded. The re-read on opening catches what was missed.
const QUIET_FOR = 2_000;

// Whether the site is in maintenance, read at boot, on every change of the
// rule heard on either live stream and whenever a stream opens again, and set
// by any call the API refused for it. The page shows to everyone but an admin.
@Injectable({ providedIn: 'root' })
export class PlatformStatus {
  private readonly platform = inject(PlatformService);
  private readonly session = inject(Session);
  private readonly state = signal(false);
  readonly maintenance = this.state.asReadonly();
  readonly isAdmin = computed(
    () => this.session.current()?.roles.includes('admin') ?? false,
  );
  readonly showPage = computed(() => this.maintenance() && !this.isAdmin());
  // Only the newest read decides, so a quick on and off ends in the last state.
  private reads = 0;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const live = inject(Live);
    const publicLive = inject(PublicLive);
    merge(live.on(CHANGED), publicLive.on(CHANGED))
      .pipe(filter((m) => m.id === RULE))
      .subscribe(() => void this.read());
    merge(live.resync, publicLive.resync).subscribe(() => void this.read());

    const settled = signal(false);
    void inject(ApplicationRef)
      .whenStable()
      .then(() => setTimeout(() => settled.set(true), QUIET_FOR));
    let leave: (() => void) | null = null;
    effect(() => {
      const hold = settled() && live.state() === 'closed';
      untracked(() => {
        if (hold && !leave) leave = publicLive.register({});
        if (!hold && leave) {
          leave();
          leave = null;
        }
      });
    });
  }

  async read(): Promise<void> {
    const read = ++this.reads;
    try {
      const { maintenance } =
        await this.platform.platformStatusControllerStatus();
      if (read === this.reads) this.state.set(maintenance);
    } catch {
      // Unknown is not a reason to hide the site: keep what was known.
    }
  }

  on(): void {
    this.reads++;
    this.state.set(true);
  }
}
