import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  PLATFORM_ID,
  untracked,
} from '@angular/core';
import type { VerificationPresenceDto } from '@motor-fix/contracts';
import { ApiConfiguration } from '@motor-fix/data-access/api-configuration';
import { AdminService } from '@motor-fix/data-access/services/admin.service';
import { formatClock, I18n } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { liveView } from '../../live/view';
import { Live } from '../live';
import { Session } from '../session';

// The beat that keeps this admin on the file for the others; the server
// forgets an entry a minute after its last beat.
const HEARTBEAT_MS = 20_000;

// Who else has the verification file open, while this drawer shows it. The
// first read is the first heartbeat; closing the drawer or the page leaves.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Lamp],
  selector: 'mf-verification-presence',
  styleUrl: './verification-presence.css',
  templateUrl: './verification-presence.html',
})
export class VerificationPresence {
  readonly fileId = input.required<string>();

  private readonly admin = inject(AdminService);
  private readonly config = inject(ApiConfiguration);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  private readonly session = inject(Session);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  // The bearer of the last heartbeat that answered: sign-out drops the
  // session's token before the drawer closes, and the leave still needs one.
  private token: string | null = null;
  private left = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  private readonly view = liveView<VerificationPresenceDto>(
    async () => {
      // The view reads at once, in the constructor: the input is set by the
      // end of the same change detection, so the read waits for it.
      await Promise.resolve();
      if (this.left) throw new Error('left the file');
      const token = this.session.token();
      const answer = await this.admin.verificationFileControllerPresence({
        id: this.fileId(),
      });
      if (!this.left) this.token = token;
      return answer;
    },
    {
      changes: this.live.events.pipe(
        filter((m) => m.kind === 'presence.changed' && m.id === this.fileId()),
      ),
      goneOn: [404],
      resync: this.live.resync,
    },
  );

  protected readonly text = computed(() => {
    const others = this.view.failed() ? [] : (this.view.value()?.others ?? []);
    this.i18n.language();
    const [first] = others;
    if (!first) return null;
    if (others.length === 1)
      return this.i18n.t('admin.file.presence.one', {
        name: first.name,
        time: formatClock(first.since),
      });
    const items = others.map(({ name, since }) =>
      this.i18n.t('admin.file.presence.item', {
        name,
        time: formatClock(since),
      }),
    );
    const last = items.pop();
    const list = `${items.join(', ')} ${this.i18n.t('admin.file.presence.and')} ${last}`;
    return this.i18n.t('admin.file.presence.many', { list });
  });

  constructor() {
    if (!this.browser) return;
    // The first read waits for the input; the beat starts with it.
    effect(() => {
      this.fileId();
      untracked(() => {
        this.timer ??= setInterval(() => this.view.reload(), HEARTBEAT_MS);
      });
    });
    window.addEventListener('pagehide', this.leave);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('pagehide', this.leave);
      this.leave();
    });
  }

  // Sent with keepalive, so it outlives the page; once per drawer.
  private readonly leave = () => {
    if (this.left) return;
    this.left = true;
    clearInterval(this.timer);
    const token = this.token;
    if (!token) return;
    fetch(
      `${this.config.rootUrl}/api/v1/admin/verification-files/${this.fileId()}/presence`,
      {
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
        method: 'DELETE',
      },
    ).catch(() => undefined);
  };
}
