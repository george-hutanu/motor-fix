import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  Injectable,
  Injector,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { PlatformService } from '@motor-fix/data-access';

import { Session } from '../dashboard/session';

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
    () => this.session.current()?.roles?.includes('admin') ?? false,
  );
  readonly showPage = computed(() => this.maintenance() && !this.isAdmin());
  // Settles once the streams are wired: their code loads apart, since the
  // signed-in stream would otherwise weigh on every visitor's first download.
  readonly listening: Promise<void>;
  // Only the newest read decides, so a quick on and off ends in the last state.
  private reads = 0;

  constructor() {
    const injector = inject(Injector);
    this.listening = isPlatformBrowser(inject(PLATFORM_ID))
      ? import('./platform-listen')
          .then((m) => m.listen(this, injector))
          // Code that fails to load leaves what the boot read and calls tell.
          .catch(() => undefined)
      : Promise.resolve();
  }

  async read(): Promise<void> {
    const read = ++this.reads;
    try {
      const { maintenance } =
        await this.platform.platformStatusControllerStatus();
      // Only a true flag takes the site down; anything else reads as up.
      if (read === this.reads) this.state.set(maintenance === true);
    } catch {
      // Unknown is not a reason to hide the site: keep what was known.
    }
  }

  on(): void {
    this.reads++;
    this.state.set(true);
  }
}
