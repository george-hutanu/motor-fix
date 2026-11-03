import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { AdminService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { liveView } from '../../live/view';
import { Live } from '../live';

// The six skeleton tiles drawn while the first read is out.
const SKELETONS = [0, 1, 2, 3, 4, 5];

@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-admin-status',
  styleUrl: './admin-status.css',
  templateUrl: './admin-status.html',
})
export class AdminStatus {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  protected readonly headingId = inject(_IdGenerator).getId('mf-status-');
  protected readonly skeletons = SKELETONS;

  // Read in the browser only: the server render shows the skeletons.
  protected readonly view = isPlatformBrowser(inject(PLATFORM_ID))
    ? liveView(() => this.api.statusControllerRead(), {
        changes: this.live.events.pipe(
          filter((m) => m.kind === 'status_tile.changed'),
        ),
        goneOn: [],
        resync: this.live.resync,
        retryAfter: 60_000,
      })
    : undefined;

  private readonly language = computed(() =>
    this.i18n.language() === 'en' ? 'en' : 'ro',
  );

  protected readonly tiles = computed(() => {
    const language = this.language();
    return (this.view?.value()?.tiles ?? []).map((tile) => ({
      key: tile.key,
      name: `admin.status.name.${tile.key}`,
      short: tile.short[language],
      state: tile.state,
      word: `admin.status.lamp.${tile.state}`,
    }));
  });

  protected readonly sentences = computed(
    () => this.view?.value()?.sentences[this.language()] ?? [],
  );

  constructor() {
    void this.i18n.enter('admin');
  }
}
