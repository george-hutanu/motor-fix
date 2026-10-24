import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { type DataExportDto, MeService } from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// The server names the file; a header the browser hides gets the same form.
const fileNameOf = (disposition: string | null) =>
  /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ??
  `motorfix-date-${new Date().toISOString().slice(0, 10)}.zip`;

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

type View = 'loading' | 'unread' | 'request' | 'queued' | 'ready';

// "Descarcă datele mele": the newest export as the server states it. The
// server's `canRequestAt` is the once-a-day rule; the panel never recomputes it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-data-export',
  styleUrl: './data-export.css',
  templateUrl: './data-export.html',
})
export class DataExport implements OnInit {
  private readonly api = inject(MeService);
  private readonly i18n = inject(I18n);

  private readonly latest = signal<DataExportDto | null>(null);
  private readonly read = signal<'loading' | 'read' | 'unread'>('loading');
  // A 429 answer: the server's word that a request is younger than a day.
  private readonly refused = signal(false);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly view = computed<View>(() => {
    const read = this.read();
    if (read !== 'read') return read;
    const status = this.latest()?.status;
    return status === 'queued' || status === 'ready' ? status : 'request';
  });
  protected readonly failed = computed(
    () => this.latest()?.status === 'failed',
  );
  protected readonly tooSoon = computed(
    () =>
      this.view() === 'request' &&
      (this.refused() || !!this.latest()?.canRequestAt),
  );
  protected readonly expires = computed(() =>
    this.i18n.t('shell.dataExport.expires', {
      date: formatDay(this.latest()?.expiresAt, this.i18n.language()),
    }),
  );

  ngOnInit() {
    void this.load();
  }

  protected async load() {
    this.error.set(null);
    this.read.set('loading');
    try {
      this.latest.set((await this.api.dataExportControllerLatest()) ?? null);
      this.refused.set(false);
      this.read.set('read');
    } catch (failure) {
      this.error.set(this.problemText(failure));
      this.read.set('unread');
    }
  }

  protected async request() {
    if (this.sending() || this.tooSoon()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      this.latest.set(await this.api.dataExportControllerRequest());
    } catch (failure) {
      const { status } = toProblem(failure);
      if (status === 429) this.refused.set(true);
      else if (status === 409) await this.load();
      else this.error.set(this.problemText(failure));
    } finally {
      this.sending.set(false);
    }
  }

  // The file comes through the API client, which carries the session; a
  // plain link would reach the server with no token. A file gone meanwhile
  // (expired, or deleted) reloads the state.
  protected async download() {
    if (this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const answer = await this.api.dataExportControllerDownload$Response();
      saveFile(
        answer.body,
        fileNameOf(answer.headers.get('content-disposition')),
      );
    } catch (failure) {
      const { status } = toProblem(failure);
      if (status === 404) await this.load();
      else this.error.set(this.problemText(failure));
    } finally {
      this.sending.set(false);
    }
  }

  private problemText(failure: unknown) {
    const key = `shell.form.problem.${toProblem(failure).code}`;
    const text = this.i18n.t(key);
    return text === key ? this.i18n.t('shell.form.problem.error') : text;
  }
}
