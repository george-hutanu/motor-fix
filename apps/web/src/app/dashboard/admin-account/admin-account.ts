import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type AdminAccountDocumentDto,
  type AdminAccountPageDto,
  AdminService,
  type AuditEntryDto,
  AuditHistoryService,
  VerificationDocumentsService,
} from '@motor-fix/data-access';
import {
  formatClock,
  formatDay,
  formatNum,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { injectOverlayTask, Overlays } from '@motor-fix/overlays';
import { HlmButton, Lamp } from '@motor-fix/ui-cockpit';

import { AdminAccountRepairs } from './admin-account-repairs/admin-account-repairs';
import {
  type AccountAction,
  type AccountActionResult,
  AdminAccountAction,
  type AdminAccountActionData,
} from '../admin-account-action/admin-account-action';
import { bucharestToday } from '../admin-restore-garage/admin-restore-garage';

export interface AdminAccountData {
  id: string;
  // Told after each action that changed the account, so the list reads again.
  changed?: () => void;
}

// The drawer closes itself only when the account is gone.
export type AdminAccountResult = 'deleted';

type Load = 'loading' | 'ready' | 'failed' | 'gone';

const PAGE = 50;
const KINDS = new Set([
  'access_reset',
  'account_restored',
  'account_suspended',
]);

// A value of the history as text: what was written, never markup.
const plain = (value: unknown) =>
  value === null || value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);

// An account as the admin sees it: its details, the actions it allows and
// its history, in a drawer over "Utilizatori" at /app/admin/users/<id>.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminAccountRepairs, HlmButton, Lamp, RouterLink, TranslatePipe],
  selector: 'mf-admin-account',
  styleUrl: './admin-account.css',
  templateUrl: './admin-account.html',
})
export class AdminAccount {
  private readonly api = inject(AdminService);
  private readonly audit = inject(AuditHistoryService);
  private readonly documentsApi = inject(VerificationDocumentsService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly task = injectOverlayTask<
    AdminAccountData,
    AdminAccountResult | 'cancelled'
  >();

  protected readonly state = signal<Load>('loading');
  protected readonly account = signal<AdminAccountPageDto | null>(null);
  protected readonly entries = signal<AuditEntryDto[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly historyState = signal<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  protected readonly said = signal('');
  protected readonly documentFailed = signal(false);
  protected readonly busy = signal(false);

  protected readonly details = computed(() => {
    const a = this.account();
    if (!a) return null;
    const language = this.i18n.language();
    const t = (key: string, params?: Record<string, string | number>) =>
      this.i18n.t(`admin.users.${key}`, params);
    const none = t('account.none');
    const count = (key: string, n: number) =>
      t(key, { count: n, n: formatNum(n, language) });
    return {
      activity: [
        count('cars.count', a.counts.cars),
        count('count.requests', a.counts.requests),
        count('count.reviews', a.counts.reviews),
      ].join(' · '),
      garage: a.garage
        ? t(`account.relation.${a.garage.relation}`, { name: a.garage.name })
        : none,
      joined: this.when(a.createdAt),
      language: t(`account.languages.${a.language}`),
      lastActive: a.lastActiveAt ? this.when(a.lastActiveAt) : none,
      methods: a.signInMethods.map((m) => t(`account.methodNames.${m}`)),
      roles: a.roles.map((r) => t(`roles.${r}`)).join(' + '),
      state: t(`state.${a.status}`),
    };
  });

  protected readonly lines = computed(() => {
    return this.entries().map((e) => ({
      change:
        e.oldValue !== null || e.newValue !== null
          ? this.i18n.t('admin.users.account.change', {
              from: plain(e.oldValue),
              to: plain(e.newValue),
            })
          : '',
      id: e.id,
      line: this.i18n.t('admin.users.account.line', {
        what: this.what(e),
        when: this.when(e.at),
        who: e.actor.name,
      }),
      text: e.text ?? '',
    }));
  });

  constructor() {
    void this.load();
  }

  private when(iso: string) {
    return `${formatDay(iso, this.i18n.language())}, ${formatClock(iso)}`;
  }

  private what(e: AuditEntryDto) {
    const key = 'admin.users.account.kinds';
    if (e.subjectType === 'assistant_grant')
      return this.i18n.t(`${key}.assistant_grant_revoked`);
    if (e.action === 'delete') return this.i18n.t(`${key}.delete`);
    if (e.kind && KINDS.has(e.kind)) return this.i18n.t(`${key}.${e.kind}`);
    return this.i18n.t(`${key}.other`, { field: e.field ?? e.kind ?? '' });
  }

  protected async load() {
    this.state.set(this.account() ? 'ready' : 'loading');
    try {
      const account = await this.api.accountControllerRead({
        id: this.task.data.id,
      });
      this.account.set(account);
      this.state.set('ready');
      void this.readHistory();
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.state.set(status === 404 ? 'gone' : 'failed');
    }
  }

  private async readHistory(cursor?: string) {
    const account = this.account();
    if (!account) return;
    this.historyState.set('loading');
    try {
      const page = await this.audit.auditHistoryControllerList({
        accountId: account.id,
        ...(cursor !== undefined && { cursor }),
        from: account.createdAt,
        limit: PAGE,
      });
      this.entries.update((items) =>
        cursor === undefined ? page.items : [...items, ...page.items],
      );
      this.cursor.set(page.nextCursor);
      this.historyState.set('ready');
    } catch {
      this.historyState.set('failed');
    }
  }

  protected more() {
    const cursor = this.cursor();
    if (cursor !== null) void this.readHistory(cursor);
  }

  protected retryHistory() {
    void this.readHistory();
  }

  protected async act(action: AccountAction) {
    const account = this.account();
    if (!account || this.busy()) return;
    this.busy.set(true);
    this.said.set('');
    try {
      const result = await this.overlays.open<
        AccountActionResult,
        AdminAccountActionData
      >(AdminAccountAction, {
        data: {
          action,
          id: account.id,
          name: account.name,
          today: bucharestToday(),
        },
        shape: 'dialog',
        title: `admin.users.dialogs.${action}.title`,
      });
      await this.after(action, result);
    } finally {
      this.busy.set(false);
    }
  }

  private async after(action: AccountAction, result: string) {
    if (result === 'cancelled') return;
    if (result === 'gone') {
      this.task.data.changed?.();
      this.account.set(null);
      this.state.set('gone');
      return;
    }
    if (result === 'done' || result === 'email_failed')
      this.task.data.changed?.();
    if (action === 'delete' && result === 'done') {
      this.task.markUnchanged();
      this.task.close('deleted');
      return;
    }
    await this.load();
    const key =
      result === 'stale'
        ? 'account.changed'
        : result === 'email_failed'
          ? 'account.emailFailed'
          : `done.${action}`;
    this.said.set(this.i18n.t(`admin.users.${key}`));
  }

  // A blank tab first, while the press still counts as one, then its address.
  protected async openDocument(doc: AdminAccountDocumentDto, n: number) {
    const tab = window.open('', '_blank');
    this.documentFailed.set(false);
    try {
      const { url } =
        await this.documentsApi.legalDocumentsControllerPageAddress({
          documentId: doc.id,
          id: doc.verificationFileId,
          n: String(n),
        });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
    } catch {
      tab?.close();
      this.documentFailed.set(true);
    }
  }

  protected documentName(doc: AdminAccountDocumentDto) {
    return this.i18n.t(`admin.file.changes.subjects.${doc.kind}`);
  }

  protected pages(doc: AdminAccountDocumentDto) {
    return Array.from({ length: doc.pages }, (_, i) => i + 1);
  }
}
