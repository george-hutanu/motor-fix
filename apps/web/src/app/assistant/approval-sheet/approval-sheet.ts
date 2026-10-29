import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  effect,
  Injector,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  type AssistantActionApprovalDto,
  type AssistantActionOptionDto,
  MeService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { APPROVAL_EVENTS, liveResource } from '../../dashboard/live';
import { httpStatus } from '../../http-status';

export interface ApprovalSheetData {
  id: string;
}

// The assistant's action waiting for the person's approval, or how it ended.
// Closes with the next pending approval's id, or null when none is left.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-approval-sheet',
  styleUrl: './approval-sheet.css',
  templateUrl: './approval-sheet.html',
})
export class ApprovalSheet {
  private readonly me = inject(MeService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly task = injectOverlayTask<ApprovalSheetData, string | null>();
  private readonly id = this.task.data.id;
  private readonly doneButton =
    viewChild<ElementRef<HTMLButtonElement>>('done');

  protected readonly approval = liveResource(
    () => this.me.assistantApprovalsControllerGet({ id: this.id }),
    APPROVAL_EVENTS,
    () => this.id,
  );
  // The ticks the person changed, by option.
  private readonly ticks = signal<Record<string, boolean>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.approval.value()) untracked(() => this.task.focusStart());
    });
  }

  protected ticked(option: AssistantActionOptionDto) {
    return this.ticks()[option.key] ?? option.value;
  }

  protected tick(option: AssistantActionOptionDto, event: Event) {
    const { checked } = event.target as HTMLInputElement;
    this.ticks.update((ticks) => ({ ...ticks, [option.key]: checked }));
  }

  // The option's name, or its key while no text names it.
  protected label(option: AssistantActionOptionDto) {
    const key = `assistant.approval.option.${option.key}`;
    const text = this.i18n.t(key);
    return text === key ? option.key : text;
  }

  protected state(approval: AssistantActionApprovalDto) {
    if (approval.status !== 'failed')
      return this.i18n.t(`assistant.approval.state.${approval.status}`);
    // A code with a reason written for it reads as that; any other as refused.
    const key = `assistant.approval.reason.${approval.outcome?.['code'] ?? ''}`;
    const reason = this.i18n.t(key);
    return this.i18n.t('assistant.approval.state.failed', {
      reason:
        reason === key
          ? this.i18n.t('assistant.approval.reason.other')
          : reason,
    });
  }

  protected readonly options = computed(() =>
    Object.fromEntries(
      (this.approval.value()?.options ?? []).map((o) => [
        o.key,
        this.ticked(o),
      ]),
    ),
  );

  protected async decide(how: 'approve' | 'refuse') {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (how === 'approve')
        await this.me.assistantApprovalsControllerApprove({
          body: { options: this.options() },
          id: this.id,
        });
      else await this.me.assistantApprovalsControllerRefuse({ id: this.id });
      await this.decided();
    } catch (error) {
      await this.refused(httpStatus(error));
    } finally {
      this.busy.set(false);
    }
  }

  // Decided meanwhile, elsewhere: its state shows. Unavailable: it stays
  // pending, to try again.
  private async refused(status: number) {
    if (status === 409 || status === 404) return this.decided();
    this.error.set(
      this.i18n.t(
        status === 503
          ? 'assistant.approval.again'
          : 'assistant.approval.error',
      ),
    );
  }

  // The next pending approval, or the end.
  protected async next() {
    const list = await this.me
      .assistantApprovalsControllerList()
      .catch(() => null);
    const next = list?.items.find((a) => a.id !== this.id);
    this.task.close(next?.id ?? null);
  }

  private async decided() {
    this.task.markUnchanged();
    await this.approval.reload();
    afterNextRender(() => this.doneButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
