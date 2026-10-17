import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
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
  type VerificationDecisionDto,
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
import { VerificationRegisterForm } from '../verification-register-form/verification-register-form';
import { VerificationReopen } from '../verification-reopen/verification-reopen';

type CheckKind = VerificationFileCheckDto['kind'];
type Result = VerificationFileCheckDto['result'];

const REGISTER: readonly CheckKind[] = ['company', 'caen', 'rar', 'activities'];
// The register checks an admin records through the form, each with the
// public look-ups it is checked against. Fixed addresses: no CUI in them.
const LOOKUPS: Partial<Record<CheckKind, { name: string; url: string }[]>> = {
  caen: [{ name: 'onrc', url: 'https://portal.onrc.ro/' }],
  company: [
    {
      name: 'anaf',
      url: 'https://mfinante.gov.ro/ro/web/site/info-pj-selectie-dupa-cui',
    },
    { name: 'onrc', url: 'https://portal.onrc.ro/' },
  ],
};
type FormKind = 'company' | 'caen';
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
// The 409s a decision answers in the footer, each by its line.
const REFUSALS: Record<string, string | undefined> = {
  caen_check_required: 'caenRequired',
  rar_check_required: 'rarRequired',
};
const SKELETON_SECTIONS = [0, 1, 2, 3];
// How often a drawer left open reads the clock again, so "azi" turns into
// "ieri" soon after midnight with no new read.
const TICK_MS = 60_000;

interface VerificationFileData {
  fileId: string;
}

// "Dosar de verificare": everything an admin reads to decide one garage's
// file, opened once (the file moves to "in review") and read again on every
// change to it. The four manual checks tick and untick through the record
// call; a decided file reads only and can be reopened. decide() sends a
// decision and answers a refusal in the footer.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Lamp, TranslatePipe, VerificationRegisterForm],
  selector: 'mf-verification-file',
  styleUrl: './verification-file.css',
  templateUrl: './verification-file.html',
})
export class VerificationFile {
  private readonly api = inject(AdminService);
  private readonly documentsApi = inject(VerificationDocumentsService);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly fileId =
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
  // The register row whose record form is open, one at a time.
  protected readonly formOpen = signal<FormKind | null>(null);
  // Why the last decision was refused, kept over later reads until the next.
  protected readonly refused = signal<string | null>(null);
  // A decision or a reopening on its way: a second press waits for nothing.
  private busy = false;

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

  protected readonly register = computed(() => {
    const decided = this.decided();
    const open = this.formOpen();
    return REGISTER.map((kind) => {
      const row = this.checkRow(kind);
      const recordable = kind in LOOKUPS && !decided;
      return {
        ...row,
        form: recordable ? (kind as FormKind) : null,
        links: (LOOKUPS[kind] ?? []).map((l) => ({
          text: this.t(`register.${l.name}`),
          url: l.url,
        })),
        open: recordable && open === kind,
        ticks: kind === 'caen' ? this.storedTicks() : null,
        toggle: this.t(
          row.result === 'not_run' ? 'register.open' : 'register.change',
        ),
      };
    });
  });

  // What the register form needs to know about the garage and its file.
  protected readonly formFacts = computed(() => {
    const value = this.file.value();
    const mobile = value?.garage.businessKind === 'mobile';
    return {
      address:
        (mobile ? value?.garage.seatAddress : value?.garage.address) ?? null,
      certificate: (value?.documents ?? []).some(
        (d) => d.kind === 'onrc_certificate' && d.present,
      ),
      mobile,
    };
  });

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
      lines: entries.map((entry) => ({
        id: entry.id,
        text: this.line(entry, value),
      })),
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

  // The display follows the server's answer: a decision taken first by
  // another admin is named and read again; a missing register check is
  // named, with nothing to re-read.
  async decide(body: VerificationDecisionDto) {
    if (this.busy) return;
    this.busy = true;
    this.refused.set(null);
    try {
      await this.api.verificationFileControllerDecision({
        body,
        id: this.fileId,
      });
      this.file.reload();
      this.focusHeading();
    } catch (error) {
      this.refusal(error);
    } finally {
      this.busy = false;
    }
  }

  // Asks first; a decision that is reopened stays shown until the next one.
  async reopen() {
    if (this.busy || !this.decided()) return;
    this.busy = true;
    try {
      const answer = await this.overlays.open<true>(VerificationReopen, {
        shape: 'dialog',
        title: 'admin.file.reopen.title',
      });
      if (answer !== true) {
        this.focusReopen();
        return;
      }
      await this.api.verificationFileControllerReopen({ id: this.fileId });
      this.refused.set(null);
      this.file.reload();
      this.focusHeading();
    } catch {
      toast(this.t('reopen.failed'));
    } finally {
      this.busy = false;
    }
  }

  private refusal(error: unknown) {
    const problem = toProblem(error);
    const known = REFUSALS[problem.code ?? ''];
    if (known) {
      this.refused.set(this.t(`footer.${known}`));
    } else if (problem.code === 'verification_transition_refused') {
      this.refused.set(
        this.t('footer.alreadyDecided', {
          name: problem.decidedBy || SYSTEM_NAME,
          time: this.when(problem.decidedAt ?? null),
        }),
      );
      this.file.reload();
    } else {
      toast(this.t('footer.saveFailed'));
    }
  }

  private focusHeading() {
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>('h3')?.focus(),
    );
  }

  private focusReopen() {
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('[data-part="reopen"]')
        ?.focus(),
    );
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

  // The look-up opens in its own tab as any link does; the CUI goes to the
  // clipboard beside it, quietly when there is no clipboard to write to.
  async copyCui() {
    const cui = this.file.value()?.garage.cui;
    const clipboard = globalThis.navigator?.clipboard;
    if (!cui || !clipboard) return;
    try {
      await clipboard.writeText(cui);
      toast(this.t('register.copied'));
    } catch {
      // The tab still opens; the admin types the CUI there.
    }
  }

  toggleForm(kind: FormKind) {
    const closing = this.formOpen() === kind;
    this.formOpen.set(closing ? null : kind);
    if (closing) this.focusToggle(kind);
  }

  formRecorded(kind: FormKind, answer: VerificationCheckRecordedDto) {
    this.apply(answer);
    this.formOpen.set(null);
    this.focusToggle(kind);
  }

  formDecided() {
    this.formOpen.set(null);
    this.file.reload();
  }

  private focusToggle(kind: FormKind) {
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(`[data-toggle="${kind}"]`)
        ?.focus(),
    );
  }

  // "certificat · ONRC · adresă": the ticks an ok CAEN check was saved with, a
  // file that held no certificate then read as "fără certificat". A warning
  // or a failure shows its detail alone: the ticks are cleared from the row.
  private storedTicks() {
    const caen = this.checks().find((c) => c.kind === 'caen');
    const evidence = caen?.result === 'ok' ? caen.evidence : null;
    if (!evidence) return null;
    const parts = [
      evidence.certificateUploaded === false
        ? this.t('register.stored.noCertificate')
        : evidence.certificate
          ? this.t('register.stored.certificate')
          : null,
      evidence.onrc ? this.t('register.stored.onrc') : null,
      evidence.address ? this.t('register.stored.address') : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
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
    // Its age when it has an issue date, else its pages: never both.
    const detail =
      this.age(doc.issuedOn) ??
      this.t('documents.pages', {
        count: doc.pages,
        n: formatNum(doc.pages, this.i18n.language()),
      });
    return `${name} · ${detail}`;
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
    // newValue is the audit's free JSON: each subject writes its own shape
    // (a document's { page }, a check's { result }), read here defensively.
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

  // A reason's label, any code without one reading as `other` (as the
  // garage's e-mail names it); then the note.
  private reason(code: string | null, note: string | null) {
    const key = `admin.file.reasons.${code}`;
    const label = code ? this.i18n.t(key) : '';
    const parts = [
      label === key ? this.i18n.t('admin.file.reasons.other') : label,
      note,
    ].filter(Boolean);
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
