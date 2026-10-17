import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  linkedSignal,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { lamp } from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type AuditEntryDto,
  type VerificationCheckRecordedDto,
  VerificationDocumentsService,
  type VerificationFileCheckDto,
  type VerificationFileDocumentDto,
  type VerificationFileDto,
} from '@motor-fix/data-access';
import {
  appliedAt,
  daysUntil,
  formatNum,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { injectOverlayTask, Overlays, toProblem } from '@motor-fix/overlays';
import { Lamp, toast } from '@motor-fix/ui-cockpit';

import { liveResource } from '../live';
import { VerificationProblem } from '../verification-problem/verification-problem';

type CheckKind = VerificationFileCheckDto['kind'];
type Result = VerificationFileCheckDto['result'];

const REGISTER: readonly CheckKind[] = ['company', 'caen', 'rar', 'activities'];
const MANUAL: readonly CheckKind[] = [
  'address',
  'photos',
  'representative',
  'documents',
];
const DECIDED = ['approved', 'rejected', 'more_requested'];
const PROBLEMS: readonly Result[] = ['warning', 'failed'];
const SYSTEM_NAME = 'MotorFix';
// A status line by the status it moved to.
const STATUS_LINES: Record<string, string | undefined> = {
  approved: 'approved',
  in_review: 'opened',
  more_requested: 'more_requested',
  rejected: 'rejected',
  submitted: 'resent',
};
const SKELETON_SECTIONS = [0, 1, 2, 3];
// How often a drawer left open reads the clock again, so "azi" turns into
// "ieri" soon after midnight with no new read.
const TICK_MS = 60_000;

export interface VerificationFileData {
  fileId: string;
}

// "Dosar de verificare": everything an admin reads to decide one garage's
// file, opened once (the file moves to "in review") and read again on every
// change to it. The four manual checks tick and untick through the record
// call; a decided file reads only. The decisions stay disabled until the decision story wires them.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Lamp, TranslatePipe],
  selector: 'mf-verification-file',
  styleUrl: './verification-file.css',
  templateUrl: './verification-file.html',
})
export class VerificationFile {
  private readonly api = inject(AdminService);
  private readonly documentsApi = inject(VerificationDocumentsService);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  private readonly fileId =
    injectOverlayTask<VerificationFileData>().data.fileId;

  // The first read that succeeds opens the file; every later one only reads.
  private opened = false;
  private readonly file = liveResource(
    () => this.load(),
    [
      'verification.opened',
      'verification.check_recorded',
      'verification.decided',
      'verification.reopened',
    ],
    () => this.fileId,
  );

  protected readonly skeleton = SKELETON_SECTIONS;
  protected readonly state = computed(() => {
    if (this.file.value()) return 'ready';
    return this.file.failed() || this.file.gone() ? 'failed' : 'loading';
  });

  // The checks as last read, each replaced by its own save's answer.
  private readonly checks = linkedSignal(() => this.file.value()?.checks ?? []);
  private readonly pending = signal<ReadonlySet<CheckKind>>(new Set());
  private readonly pageFailed = signal<{ id: string; n: number } | null>(null);
  private readonly now = signal(new Date());

  protected readonly decided = computed(() =>
    DECIDED.includes(this.file.value()?.file.status ?? ''),
  );

  protected readonly header = computed(() => {
    const value = this.file.value();
    if (!value) return undefined;
    const { garage } = value;
    const language = this.i18n.language();
    const mobile = garage.businessKind === 'mobile';
    return {
      address:
        mobile && garage.seatAddress
          ? this.t('seat', {
              km: formatNum(garage.serviceRadiusKm ?? 0, language),
              seat: garage.seatAddress,
            })
          : garage.address,
      brands: garage.brands.join(', '),
      cui: garage.cui ? this.t('cui', { cui: garage.cui }) : null,
      kind: garage.businessKind ? this.t(`kinds.${garage.businessKind}`) : null,
      name: garage.name,
      phone: garage.phone,
      photos: garage.photos.map((photo, i) => ({
        alt: this.t('photo', { n: i + 1 }),
        display: photo.displayUrl,
        height: photo.height,
        id: photo.id,
        thumbnail: photo.thumbnailUrl,
        width: photo.width,
      })),
    };
  });

  protected readonly reported = computed(() => {
    const value = this.file.value();
    if (!value) return undefined;
    const when = (at: string) => this.when(at);
    const reports = value.reports.map((r) =>
      this.t('report', { text: r.text, when: when(r.createdAt) }),
    );
    const reopened =
      value.file.reopenReason === 'garage_report' && value.file.reopenedAt
        ? this.t('reopenedReport', { when: when(value.file.reopenedAt) })
        : null;
    return reports.length || reopened ? { reopened, reports } : undefined;
  });

  protected readonly rejected = computed(() => {
    const previous = this.file.value()?.previousRejection;
    if (!previous) return undefined;
    return this.t('rejectedBefore', {
      reason: this.reason(previous.reasonCode, previous.reasonNote),
      when: this.when(previous.decidedAt),
    });
  });

  protected readonly register = computed(() =>
    REGISTER.map((kind) => this.checkRow(kind)),
  );

  private readonly missing = computed(() =>
    (this.file.value()?.documents ?? []).some((d) => !d.present),
  );

  protected readonly manual = computed(() => {
    const value = this.file.value();
    const mobile = value?.garage.businessKind === 'mobile';
    const pending = this.pending();
    const decided = this.decided();
    return MANUAL.map((kind) => {
      const row = this.checkRow(kind);
      const blocked = kind === 'documents' && this.missing();
      const wording =
        mobile && (kind === 'address' || kind === 'photos')
          ? `${kind}Mobile`
          : kind;
      return {
        ...row,
        busy: pending.has(kind),
        checked: row.result === 'ok',
        locked: decided || pending.has(kind) || blocked,
        missing: blocked,
        problem: PROBLEMS.includes(row.result),
        problemLabel: this.t('manual.problemNamed', {
          check: this.t(`checks.${kind}`),
        }),
        text: this.t(`manual.${wording}`),
      };
    });
  });

  protected readonly documents = computed(() => {
    const value = this.file.value();
    if (!value) return [];
    const failed = this.pageFailed();
    return value.documents.map((doc) => ({
      buttons: doc.present && value.storageReady ? this.pageButtons(doc) : [],
      doc,
      failed: failed?.id === doc.id ? failed.n : null,
      line: this.documentLine(doc),
      stale: this.staleLine(doc),
      unavailable: doc.present && !value.storageReady,
    }));
  });

  protected readonly history = computed(() => {
    const value = this.file.value();
    if (!value) return undefined;
    const { entries, total } = value.timeline;
    const more = total - entries.length;
    return {
      lines: entries
        .map((entry) => ({ id: entry.id, text: this.line(entry, value) }))
        .filter((line): line is { id: string; text: string } => !!line.text),
      more:
        more > 0
          ? this.t('history.more', {
              n: formatNum(more, this.i18n.language()),
            })
          : null,
    };
  });

  protected readonly footer = computed(() => {
    const file = this.file.value()?.file;
    if (!file || !this.decided()) return undefined;
    return {
      line: this.t(`lines.${file.status}`, {
        name: file.decidedBy?.name || SYSTEM_NAME,
        when: this.when(file.decidedAt),
      }),
      reason:
        file.reasonCode || file.reasonNote
          ? this.t('footer.reason', {
              reason: this.reason(file.reasonCode, file.reasonNote),
            })
          : null,
    };
  });

  retry() {
    this.file.reload();
  }

  // The display follows the server's answer, never the press.
  async tick(event: Event, kind: CheckKind) {
    const input = event.target as HTMLInputElement;
    const want = input.checked;
    input.checked = this.result(kind) === 'ok';
    if (this.decided() || this.pending().has(kind)) return;
    await this.record(kind, want ? 'ok' : 'not_run');
  }

  async markProblem(kind: CheckKind) {
    if (this.decided()) return;
    const answer = await this.overlays.open(VerificationProblem, {
      data: { fileId: this.fileId, kind },
      shape: 'dialog',
      title: 'admin.file.problem.title',
    });
    if (answer !== 'cancelled' && answer) this.apply(answer);
  }

  // A blank tab first, while the press still counts as one, then its address.
  async openPage(doc: VerificationFileDocumentDto, n: number) {
    if (!doc.id) return;
    const tab = window.open('', '_blank');
    this.pageFailed.set(null);
    try {
      const { url } =
        await this.documentsApi.legalDocumentsControllerPageAddress({
          documentId: doc.id,
          id: this.fileId,
          n: String(n),
        });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
    } catch {
      tab?.close();
      this.pageFailed.set({ id: doc.id, n });
    }
  }

  private async record(kind: CheckKind, result: Result) {
    this.pending.update((all) => new Set(all).add(kind));
    try {
      this.apply(
        await this.api.verificationChecksControllerRecord({
          body: { result },
          id: this.fileId,
          kind,
        }),
      );
    } catch (error) {
      if (toProblem(error).code === 'verification_file_decided')
        this.file.reload();
      else toast(this.t('manual.saveFailed'));
    } finally {
      this.pending.update((all) => {
        const next = new Set(all);
        next.delete(kind);
        return next;
      });
    }
  }

  private apply({ check }: VerificationCheckRecordedDto) {
    this.checks.update((all) =>
      all.map((c) => (c.kind === check.kind ? { ...c, ...check } : c)),
    );
  }

  // "Certificat constatator ONRC · emis acum 6 zile · 2 pagini".
  private documentLine(doc: VerificationFileDocumentDto) {
    const name = this.documentName(doc.kind);
    if (!doc.present) return `${name} · ${this.t('documents.missing')}`;
    const pages = this.t('documents.pages', {
      count: doc.pages,
      n: formatNum(doc.pages, this.i18n.language()),
    });
    return [name, this.age(doc.issuedOn), pages].filter(Boolean).join(' · ');
  }

  // The certificate's warning: too old when sent, or no issue date at all.
  private staleLine(doc: VerificationFileDocumentDto) {
    if (!doc.stale) return null;
    return this.t(doc.issuedOn ? 'documents.stale' : 'documents.noDate');
  }

  // "Deschide" for one page, "Deschide pagina n" for each of several.
  private pageButtons(doc: VerificationFileDocumentDto) {
    const document = this.documentName(doc.kind);
    const one = doc.pages === 1;
    return Array.from({ length: doc.pages }, (_, i) => i + 1).map((n) => ({
      label: one
        ? this.t('documents.open')
        : this.t('documents.openPage', { n }),
      n,
      named: one
        ? this.t('documents.openNamed', { document })
        : this.t('documents.openPageNamed', { document, n }),
    }));
  }

  private async load(): Promise<VerificationFileDto> {
    const id = this.fileId;
    if (this.opened) return this.api.verificationFileControllerRead({ id });
    const file = await this.api.verificationFileControllerOpen({ id });
    this.opened = true;
    return file;
  }

  private result(kind: CheckKind): Result {
    return this.checks().find((c) => c.kind === kind)?.result ?? 'not_run';
  }

  private checkRow(kind: CheckKind) {
    const check = this.checks().find((c) => c.kind === kind);
    const result = check?.result ?? 'not_run';
    const value = this.file.value();
    const language = this.i18n.language();
    const activities =
      kind === 'activities' && result === 'ok' && value
        ? value.activities
            .map((a) => (language === 'en' ? a.nameEn : a.nameRo))
            .join(', ')
        : null;
    const recorder = check?.recorder;
    return {
      activities: activities || null,
      detail: check?.detail ?? null,
      kind,
      label: REGISTER.includes(kind) ? this.t(`register.${kind}`) : '',
      lamp: lamp(result),
      recorded: recorder
        ? check?.recordedAt
          ? this.t('recorded', {
              name: recorder.name,
              when: this.when(check.recordedAt),
            })
          : recorder.name
        : null,
      result,
      resultLabel: this.t(`results.${result}`),
    };
  }

  // "emis azi", "emis ieri", "emis acum 6 zile", counted in Bucharest.
  private age(issuedOn: string | null) {
    if (!issuedOn) return null;
    const days = daysUntil(issuedOn, this.now());
    if (days === null) return null;
    const ago = -days;
    if (ago <= 0) return this.t('documents.today');
    if (ago === 1) return this.t('documents.yesterday');
    return this.t('documents.ago', {
      count: ago,
      n: formatNum(ago, this.i18n.language()),
    });
  }

  private line(entry: AuditEntryDto, value: VerificationFileDto) {
    const name = entry.actor?.name || SYSTEM_NAME;
    const when = this.when(entry.at);
    const next = entry.newValue as unknown;
    if (entry.subjectType === 'legal_document')
      return this.t('lines.page', {
        document: this.documentName(entry.kind ?? ''),
        n: (next as { page?: number } | null)?.page ?? 1,
        name,
        when,
      });
    if (entry.subjectType === 'verification_check')
      return this.t('lines.check', {
        check: this.t(`checks.${entry.field}`),
        name,
        result: this.t(
          `results.${(next as { result?: Result } | null)?.result ?? 'not_run'}`,
        ),
        when,
      });
    if (entry.action === 'create')
      return this.t('lines.sent', {
        name: value.file.declaredByName || name,
        when,
      });
    return this.statusLine(entry, name, when);
  }

  // A status change: opened, decided, reopened (with its reason) or resent.
  private statusLine(entry: AuditEntryDto, name: string, when: string) {
    if (entry.kind === 'verification_reopened')
      return entry.text
        ? this.t('lines.reopenedWhy', { name, reason: entry.text, when })
        : this.t('lines.reopened', { name, when });
    const line =
      entry.kind === 'verification_resent'
        ? 'resent'
        : STATUS_LINES[String(entry.newValue)];
    // A change this drawer has no words for still takes its one line.
    return this.t(`lines.${line ?? 'changed'}`, { name, when });
  }

  // A reason's label when it has one, else its code; then the note.
  private reason(code: string | null, note: string | null) {
    const key = `admin.file.reasons.${code}`;
    const label = code ? this.i18n.t(key) : '';
    const parts = [label === key ? code : label, note].filter(Boolean);
    return parts.length ? parts.join(' — ') : this.t('noReason');
  }

  private documentName(kind: string) {
    return this.i18n.t(`public.listing.documents.kinds.${kind}.label`);
  }

  private when(at: string | null) {
    return appliedAt(at, this.i18n.language(), this.now());
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.file.${key}`, params);
  }

  constructor() {
    void this.i18n.enter('admin');
    void this.i18n.enter('public');
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
