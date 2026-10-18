import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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
import { rarNumberRefused } from '@motor-fix/contracts/listing-verification';
import {
  type ApprovalGap,
  approvalGaps,
  approvalGapsFrom,
  lamp,
} from '@motor-fix/contracts/verification-target';
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
import { HlmButton, Lamp, toast } from '@motor-fix/ui-cockpit';

import { liveResource } from '../live';
import {
  VerificationApprove,
  type VerificationApproveData,
} from '../verification-approve/verification-approve';
import { VerificationProblem } from '../verification-problem/verification-problem';
import { VerificationRegisterForm } from '../verification-register-form/verification-register-form';
import {
  VerificationReject,
  type VerificationRejectData,
  type VerificationRejection,
  type VerificationRejectRefusal,
} from '../verification-reject/verification-reject';
import { VerificationReopen } from '../verification-reopen/verification-reopen';

type CheckKind = VerificationFileCheckDto['kind'];
type Result = VerificationFileCheckDto['result'];

const REGISTER: readonly CheckKind[] = ['company', 'caen', 'rar', 'activities'];
// What a look-up copies to the clipboard as it opens.
type Copied = 'cui' | 'rar';
type Lookup = { name: string; url: string; copy: Copied };
const ONRC: Lookup = {
  copy: 'cui',
  name: 'onrc',
  url: 'https://portal.onrc.ro/',
};
// The register checks an admin records through the form, each with the
// public look-ups it is checked against. Fixed addresses: no CUI or number
// in them.
const LOOKUPS: Partial<Record<CheckKind, Lookup[]>> = {
  caen: [ONRC],
  company: [
    {
      copy: 'cui',
      name: 'anaf',
      url: 'https://mfinante.gov.ro/ro/web/site/info-pj-selectie-dupa-cui',
    },
    ONRC,
  ],
  rar: [{ copy: 'rar', name: 'rarRegister', url: 'https://portal.rarom.ro/' }],
};
type FormKind = 'company' | 'caen' | 'rar' | 'activities';
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
  rar_check_required: 'rarCheckRequired',
};
// The 422s a rejection answers by asking again, each by the field it marks.
const REJECTION_REFUSALS: Record<
  string,
  VerificationRejectRefusal | undefined
> = {
  note_required: 'noteRequired',
  note_too_short: 'noteTooShort',
  reason_required: 'reasonRequired',
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
  imports: [HlmButton, Lamp, TranslatePipe, VerificationRegisterForm],
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

  // The file as last read, or as a correction answered it.
  protected readonly data = linkedSignal(() => this.file.value());

  protected readonly skeleton = SKELETON_SECTIONS;
  protected readonly state = computed(() => {
    if (this.data()) return 'ready';
    return this.file.failed() || this.file.gone() ? 'failed' : 'loading';
  });

  // The checks as last read, each replaced by its own save's answer.
  private readonly checks = linkedSignal(() => this.data()?.checks ?? []);
  private readonly pending = signal<ReadonlySet<CheckKind>>(new Set());
  private readonly pageFailed = signal<{ id: string; n: number } | null>(null);
  private readonly now = signal(new Date());
  // The register row whose record form is open, one at a time.
  protected readonly formOpen = signal<FormKind | null>(null);
  // Why the last decision was refused, kept over later reads until the next.
  protected readonly refused = signal<string | null>(null);
  // A decision or a reopening on its way: a second press waits for nothing.
  protected readonly busy = signal(false);
  // The rejection is the call on its way, so its button carries the spinner.
  protected readonly rejecting = signal(false);
  // The RAR number's correction field: what is typed, and its refusal.
  protected readonly correcting = signal<string | null>(null);
  protected readonly correctError = signal<string | null>(null);
  private readonly correctBusy = signal(false);

  protected readonly decided = computed(() =>
    DECIDED.includes(this.data()?.file.status ?? ''),
  );

  protected readonly header = computed(() => {
    const value = this.data();
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
      cuiShared: garage.cuiAlsoUsedBy.length
        ? this.t('cuiShared', { names: garage.cuiAlsoUsedBy.join(', ') })
        : null,
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
    const value = this.data();
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
    const previous = this.data()?.previousRejection;
    if (!previous) return undefined;
    return this.t('rejectedBefore', {
      reason: this.reason(previous.reasonCode, previous.reasonNote),
      when: this.when(previous.decidedAt),
    });
  });

  protected readonly register = computed(() => {
    const decided = this.decided();
    const open = this.formOpen();
    const number = this.data()?.file.rarNumber ?? this.t('register.noNumber');
    return REGISTER.map((kind) => {
      const row = this.checkRow(kind);
      const form = decided ? null : (kind as FormKind);
      return {
        ...row,
        correctable: form === 'rar',
        form,
        links: this.links(kind),
        number: kind === 'rar' ? number : null,
        open: form !== null && open === kind,
        ticks: this.storedTicks(kind),
        toggle: this.t(
          row.result === 'not_run' ? 'register.open' : 'register.change',
        ),
        uncovered: kind === 'activities' ? this.uncoveredLine() : null,
      };
    });
  });

  // What the activities form shows beside the catalogue: the RAR
  // authorisation as the documents section reads it.
  protected readonly authorisation = computed(() => {
    const row = this.documents().find(
      (d) => d.doc.kind === 'rar_authorisation' && d.doc.present,
    );
    return row ? { buttons: row.buttons, doc: row.doc, line: row.line } : null;
  });
  protected readonly activityCodes = computed(() =>
    (this.data()?.activities ?? []).map((a) => a.code),
  );

  // Why the approve button is held: the RAR check first, then CAEN; none
  // once both are ok or the file is decided.
  protected readonly gateHint = computed(() => {
    if (this.decided()) return null;
    if (this.result('rar') !== 'ok') return this.t('footer.rarRequired');
    if (this.result('caen') !== 'ok') return this.t('footer.caenHint');
    return null;
  });

  // What the register form needs to know about the garage and its file.
  protected readonly formFacts = computed(() => {
    const value = this.data();
    const mobile = value?.garage.businessKind === 'mobile';
    return {
      address:
        (mobile ? value?.garage.seatAddress : value?.garage.address) ?? null,
      certificate: (value?.documents ?? []).some(
        (d) => d.kind === 'onrc_certificate' && d.present,
      ),
      mobile,
      rarNumber: value?.file.rarNumber ?? null,
    };
  });

  private readonly missing = computed(() =>
    (this.data()?.documents ?? []).some((d) => !d.present),
  );

  protected readonly manual = computed(() => {
    const value = this.data();
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
    const value = this.data();
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
    const value = this.data();
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
    const file = this.data()?.file;
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
    if (this.busy()) return;
    this.busy.set(true);
    this.refused.set(null);
    try {
      await this.api.verificationFileControllerDecision({
        body,
        id: this.fileId,
      });
      this.file.reload();
    } catch (error) {
      this.refusal(error);
    } finally {
      this.busy.set(false);
    }
  }

  // Asks first, listing what the approval passes over; the note it needs is
  // the dialog's to ask for. A note_required answer (a check changed since
  // the read) reads the file again and asks again with the server's missing
  // list (the re-read's own when the answer carries none); any other failure
  // is told and read again, so a decision that committed before the failure
  // is shown and never offered twice.
  // Held while the dialog is open, so a second press opens no second one.
  private asking = false;

  async approve(missing?: ApprovalGap[]) {
    if (this.asking || this.busy() || this.gateHint() || this.decided()) return;
    this.asking = true;
    const answer = await this.overlays
      .open<{ note?: string }, VerificationApproveData>(VerificationApprove, {
        data: { missing: missing ?? this.gaps() },
        shape: 'dialog',
        title: 'admin.file.approve.title',
      })
      .finally(() => {
        this.asking = false;
      });
    if (answer === 'cancelled') {
      this.focus('[data-part="approve"]');
      return;
    }
    const again = await this.sendApproval(answer);
    if (again) await this.approve(again.missing ?? undefined);
  }

  // Sends the approval; the server's missing list (none when it sent no
  // readable one) when it must be asked for again, else null.
  private async sendApproval(answer: {
    note?: string;
  }): Promise<{ missing: ApprovalGap[] | null } | null> {
    if (this.busy()) return null;
    this.busy.set(true);
    this.refused.set(null);
    try {
      await this.api.verificationFileControllerDecision({
        body: { decision: 'approved', ...answer },
        id: this.fileId,
      });
      this.file.reload();
      this.focus('h3');
      return null;
    } catch (error) {
      return await this.approvalFailed(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async approvalFailed(error: unknown) {
    const code = toProblem(error).code ?? '';
    if (code === 'note_required') {
      const missing = serverMissing(error);
      return (await this.reread()) ? { missing } : null;
    }
    this.refusal(error);
    // A named refusal changes nothing; the transition refusal re-reads.
    const told = REFUSALS[code] || code === 'verification_transition_refused';
    if (!told) this.file.reload();
    return null;
  }

  // Asks for a reason and a message, then sends them. A 422 on either field
  // reads the file again and, while it still waits, asks again with what was
  // written and the field marked; any other failure is told as an approval's.
  async reject(values: VerificationRejectData = {}) {
    if (this.asking || this.busy() || this.decided()) return;
    this.asking = true;
    const answer = await this.overlays
      .open<VerificationRejection, VerificationRejectData>(VerificationReject, {
        data: values,
        shape: 'dialog',
        title: 'admin.file.reject.title',
      })
      .finally(() => {
        this.asking = false;
      });
    if (answer === 'cancelled') {
      this.focus('[data-part="reject"]');
      return;
    }
    const refused = await this.sendRejection(answer);
    if (refused) await this.reject({ ...answer, refused });
  }

  // Sends the rejection; the field to mark when it must be asked again.
  private async sendRejection(
    answer: VerificationRejection,
  ): Promise<VerificationRejectRefusal | null> {
    if (this.busy()) return null;
    this.busy.set(true);
    this.rejecting.set(true);
    this.refused.set(null);
    try {
      await this.api.verificationFileControllerDecision({
        body: { decision: 'rejected', ...answer },
        id: this.fileId,
      });
      this.file.reload();
      this.focus('h3');
      return null;
    } catch (error) {
      return await this.rejectionFailed(error);
    } finally {
      this.busy.set(false);
      this.rejecting.set(false);
    }
  }

  private async rejectionFailed(error: unknown) {
    const code = toProblem(error).code ?? '';
    const refused = REJECTION_REFUSALS[code];
    if (refused) return (await this.reread()) ? refused : null;
    this.refusal(error);
    if (code !== 'verification_transition_refused') this.file.reload();
    return null;
  }

  // The file read again in place; true when it still waits for a decision.
  private async reread() {
    try {
      this.data.set(
        await this.api.verificationFileControllerRead({ id: this.fileId }),
      );
      return !this.decided();
    } catch {
      toast(this.t('footer.saveFailed'));
      this.file.reload();
      return false;
    }
  }

  // What an approval passes over, from the file as last read.
  private gaps() {
    return approvalGaps(
      this.checks(),
      (this.data()?.documents ?? [])
        .filter((doc) => doc.present)
        .map((doc) => doc.kind),
    );
  }

  // Asks first; a decision that is reopened stays shown until the next one.
  // The button is disabled only while the call is out, so a cancelled
  // confirmation can hand focus back to it.
  async reopen() {
    if (this.busy() || !this.decided()) return;
    const answer = await this.overlays.open<true>(VerificationReopen, {
      shape: 'dialog',
      title: 'admin.file.reopen.title',
    });
    if (answer !== true) {
      this.focus('[data-part="reopen"]');
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    this.refused.set(null);
    try {
      await this.api.verificationFileControllerReopen({ id: this.fileId });
      this.file.reload();
      this.focus('h3');
    } catch {
      toast(this.t('reopen.failed'));
    } finally {
      this.busy.set(false);
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

  // Focus moves once the drawer has rendered what changed.
  private focus(selector: string) {
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
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

  // The look-up opens in its own tab as any link does; the CUI or the RAR
  // number goes to the clipboard beside it, quietly when there is nothing to
  // copy or no clipboard to write to.
  async copy(what: Copied) {
    const value = this.data();
    const text = what === 'cui' ? value?.garage.cui : value?.file.rarNumber;
    const clipboard = globalThis.navigator?.clipboard;
    if (!text || !clipboard) return;
    try {
      await clipboard.writeText(text);
      toast(this.t(what === 'cui' ? 'register.copied' : 'register.rarCopied'));
    } catch {
      // The tab still opens; the admin types it there.
    }
  }

  toggleCorrect() {
    const closing = this.correcting() !== null;
    this.correctError.set(null);
    this.correcting.set(closing ? null : (this.data()?.file.rarNumber ?? ''));
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(
          closing ? '[data-toggle="correct"]' : '[data-part="correct"] input',
        )
        ?.focus(),
    );
  }

  correctTyped(event: Event) {
    this.correcting.set((event.target as HTMLInputElement).value);
  }

  // The number as typed goes to the server, which stores it normalised; one
  // too short or with a control character is refused here first.
  async saveCorrection(event?: Event) {
    event?.preventDefault();
    const rarNumber = this.correcting() ?? '';
    if (rarNumberRefused(rarNumber)) {
      this.correctError.set(this.t('register.errors.number'));
      return;
    }
    if (this.correctBusy()) return;
    this.correctBusy.set(true);
    try {
      this.data.set(
        await this.api.verificationFileControllerCorrect({
          body: { rarNumber },
          id: this.fileId,
        }),
      );
      this.toggleCorrect();
    } catch (error) {
      this.correctFailed(error);
    } finally {
      this.correctBusy.set(false);
    }
  }

  private correctFailed(error: unknown) {
    const problem = toProblem(error);
    if (problem.code === 'verification_file_decided') {
      this.correcting.set(null);
      this.file.reload();
      return;
    }
    if (problem.status === 400) {
      this.correctError.set(this.t('register.errors.number'));
      return;
    }
    toast(this.t('manual.saveFailed'));
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

  // The ticks an ok check was saved with, as text. A warning or a failure
  // shows its detail alone: the ticks are cleared from the row.
  private storedTicks(kind: CheckKind) {
    const check = this.checks().find((c) => c.kind === kind);
    const evidence = check?.result === 'ok' ? check.evidence : null;
    if (!evidence) return null;
    if (kind === 'rar') return this.rarTicks(evidence);
    return kind === 'caen' ? this.caenTicks(evidence) : null;
  }

  // "găsită · firmă · adresă".
  private rarTicks(
    evidence: NonNullable<VerificationFileCheckDto['evidence']>,
  ) {
    const parts = (['found', 'sameCompany', 'sameAddress'] as const)
      .filter((tick) => evidence[tick])
      .map((tick) => this.t(`register.stored.${tick}`));
    return parts.length ? parts.join(' · ') : null;
  }

  // "certificat · ONRC · adresă", a file that held no certificate then read
  // as "fără certificat".
  private caenTicks(
    evidence: NonNullable<VerificationFileCheckDto['evidence']>,
  ) {
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

  // "Neacoperite: Plăcuțe de frână": the jobs a recorded activities check
  // left uncovered, by their names on the price list.
  private uncoveredLine() {
    const check = this.checks().find((c) => c.kind === 'activities');
    const ids = check?.evidence?.uncoveredJobTypeIds ?? [];
    if (check?.result === 'not_run' || !ids.length) return null;
    const en = this.i18n.language() === 'en';
    const names = (this.data()?.jobs ?? [])
      .filter((job) => ids.includes(job.jobTypeId))
      .map((job) => (en ? job.nameEn : job.nameRo));
    return names.length
      ? this.t('register.uncoveredLine', { jobs: names.join(', ') })
      : null;
  }

  private links(kind: CheckKind) {
    return (LOOKUPS[kind] ?? []).map((l) => ({
      copy: l.copy,
      text: this.t(`register.${l.name}`),
      url: l.url,
    }));
  }

  // A page of the RAR authorisation, asked for by the activities form.
  openAuthorisation(n: number) {
    const doc = this.authorisation()?.doc;
    if (doc) void this.openPage(doc, n);
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

  // The garage's recorded activities by name, or a line saying the list is
  // empty, so a recorded check never reads as if the list were unread.
  private activitiesLine() {
    const value = this.data();
    if (!value) return null;
    const en = this.i18n.language() === 'en';
    const names = value.activities.map((a) => (en ? a.nameEn : a.nameRo));
    return names.length ? names.join(', ') : this.t('register.noActivities');
  }

  private result(kind: CheckKind): Result {
    return this.checks().find((c) => c.kind === kind)?.result ?? 'not_run';
  }

  private checkRow(kind: CheckKind) {
    const check = this.checks().find((c) => c.kind === kind);
    const result = check?.result ?? 'not_run';
    const recorder = check?.recorder;
    return {
      activities:
        kind === 'activities' && result !== 'not_run'
          ? this.activitiesLine()
          : null,
      detail: check?.detail ?? null,
      kind,
      label: REGISTER.includes(kind)
        ? this.t(`register.${this.labelKey(kind, result)}`)
        : '',
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

  // A failed RAR check reads as the authorisation not found.
  private labelKey(kind: CheckKind, result: Result) {
    return kind === 'rar' && result === 'failed' ? 'rarFailed' : kind;
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

  // A change to the file: an approval refused, its RAR number corrected, or
  // its status opened, decided, reopened (with its reason) or resent.
  private statusLine(entry: AuditEntryDto, name: string, when: string) {
    const own = this.fileLine(entry, name, when);
    if (own) return own;
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

  // The file's lines that are not a status: a refused approval and a RAR
  // number correction.
  private fileLine(entry: AuditEntryDto, name: string, when: string) {
    if (entry.kind === 'verification_approval_refused')
      return this.t('lines.approvalRefused', {
        name,
        reason: this.refusalReason(String(entry.newValue ?? '')),
        when,
      });
    if (
      entry.subjectType === 'verification_file' &&
      entry.field === 'rar_number'
    )
      return this.t('lines.rarNumber', {
        name,
        new: String(entry.newValue ?? '—'),
        old: String(entry.oldValue ?? '—'),
        when,
      });
    return null;
  }

  // A refusal code this drawer has no words for reads as the code itself.
  private refusalReason(code: string) {
    const key = `admin.file.refusalReasons.${code}`;
    const label = this.i18n.t(key);
    return label === key ? code : label;
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

// The note_required refusal's own list of what the approval passes over;
// none when the answer carries no readable list or an empty one (the server
// refuses only an approval that passes something over).
function serverMissing(error: unknown) {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  const gaps = approvalGapsFrom(
    (body as { missing?: unknown } | null)?.missing,
  );
  return gaps?.length ? gaps : null;
}
