import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type AssistantActionApprovalDto,
  MeService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { ApprovalSheet, type ApprovalSheetData } from './approval-sheet';
import { Live } from '../../dashboard/live';

// @traces 1254-assistant-approvals-FR-004
// @traces 1254-assistant-approvals-FR-010

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const ID = 'ap-1';

const approval = (
  overrides: Partial<AssistantActionApprovalDto> = {},
): AssistantActionApprovalDto => ({
  assistantName: 'Claude',
  createdAt: '2026-10-29T10:00:00.000Z',
  decidedAt: null,
  expiresAt: '2026-10-29T10:30:00.000Z',
  id: ID,
  kind: 'book',
  options: [{ key: 'shareHistory', value: true }],
  outcome: null,
  status: 'pending',
  summary:
    'Programează schimbul de ulei la Service Auto Militari, joi la 10:00.',
  tool: 'book_service',
  ...overrides,
});

let api: Record<string, jest.Mock>;
let events: Subject<LiveMessage>;
let result: Promise<OverlayResult<string | null>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  shown: AssistantActionApprovalDto,
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  api = {
    assistantApprovalsControllerApprove: jest.fn(async () => shown),
    assistantApprovalsControllerGet: jest.fn(async () => shown),
    assistantApprovalsControllerList: jest.fn(async () => ({
      items: [],
      pending: 0,
    })),
    assistantApprovalsControllerRefuse: jest.fn(async () => shown),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: api },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('assistant');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    string | null,
    ApprovalSheetData
  >(ApprovalSheet, {
    data: { id: ID },
    shape: 'drawer',
    title: 'assistant.approval.title',
    titleParams: { client: 'Claude' },
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  );
const press = async (name: string) => {
  button(name)?.click();
  await settle();
};
const tick = () =>
  panel().querySelector<HTMLInputElement>('input[type="checkbox"]');
const state = () => panel().querySelector('[role="status"]');
const decided = (
  status: AssistantActionApprovalDto['status'],
  outcome: AssistantActionApprovalDto['outcome'] = null,
) => approval({ decidedAt: '2026-10-29T10:05:00.000Z', outcome, status });

afterEach(() => TestBed.resetTestingModule());

describe('ApprovalSheet', () => {
  it('shows the stored summary, one tick per option with its value, Aprobă and Refuză', async () => {
    await open(approval());

    expect(text()).toContain(
      'Programează schimbul de ulei la Service Auto Militari, joi la 10:00.',
    );
    expect(text()).toContain('Asistentul tău (Claude) vrea să:');
    expect(tick()?.checked).toBe(true);
    const label = panel().querySelector(`label[for="${tick()?.id}"]`);
    expect(text(label)).toContain('Trimite service‑ului istoricul mașinii');
    expect(button('Aprobă')).toBeDefined();
    expect(button('Refuză')).toBeDefined();
  });

  it('speaks English to an English account', async () => {
    await open(approval(), 'en');

    expect(text()).toContain('Your assistant (Claude) wants to:');
    expect(button('Approve')).toBeDefined();
    expect(button('Refuse')).toBeDefined();
  });

  it('approves with the edited option and shows a failed run with its reason', async () => {
    await open(approval());
    const tickBox = tick() as HTMLInputElement;
    tickBox.checked = false;
    tickBox.dispatchEvent(new Event('change', { bubbles: true }));
    api['assistantApprovalsControllerGet']?.mockResolvedValue(
      decided('failed', { code: 'tool_unavailable' }),
    );

    await press('Aprobă');

    expect(api['assistantApprovalsControllerApprove']).toHaveBeenCalledWith({
      body: { options: { shareHistory: false } },
      id: ID,
    });
    expect(text(state())).toBe(
      'Nu s‑a putut face: acțiunea nu mai este disponibilă.',
    );
    expect(button('Aprobă')).toBeUndefined();
  });

  it('refuses and shows the refused state', async () => {
    await open(approval());
    api['assistantApprovalsControllerGet']?.mockResolvedValue(
      decided('refused'),
    );

    await press('Refuză');

    expect(api['assistantApprovalsControllerRefuse']).toHaveBeenCalledWith({
      id: ID,
    });
    expect(api['assistantApprovalsControllerApprove']).not.toHaveBeenCalled();
    expect(text(state())).toBe('Refuzată');
  });

  it.each([
    ['approved', null, 'Aprobată'],
    ['refused', null, 'Refuzată'],
    ['expired', { code: 'timeout' }, 'Expirată'],
    [
      'failed',
      { code: 'garage_closed' },
      'Nu s‑a putut face: MotorFix a refuzat acțiunea.',
    ],
  ] as const)(
    'shows an approval already %s as "%s", with no buttons to decide',
    async (status, outcome, line) => {
      await open(decided(status, outcome));

      expect(text(state())).toBe(line);
      expect(button('Aprobă')).toBeUndefined();
      expect(button('Refuză')).toBeUndefined();
    },
  );

  it('gives the failure reason in English', async () => {
    await open(decided('failed', { code: 'tool_unavailable' }), 'en');

    expect(text(state())).toBe(
      'Could not be done: this action is no longer available.',
    );
  });

  it('keeps the approval open and asks to try again when MotorFix is unavailable', async () => {
    await open(approval());
    api['assistantApprovalsControllerApprove']?.mockRejectedValue(
      new HttpErrorResponse({
        error: { code: 'maintenance', status: 503 },
        status: 503,
      }),
    );

    await press('Aprobă');

    expect(text(panel().querySelector('[role="alert"]'))).toBe(
      'MotorFix nu poate face acum acțiunea. Încearcă din nou peste câteva minute.',
    );
    expect(button('Aprobă')).toBeDefined();
  });

  it('reads the approval again when another tab decided it first', async () => {
    await open(approval());
    api['assistantApprovalsControllerApprove']?.mockRejectedValue(
      new HttpErrorResponse({
        error: {
          code: 'approval_not_pending',
          currentStatus: 'refused',
          status: 409,
        },
        status: 409,
      }),
    );
    api['assistantApprovalsControllerGet']?.mockResolvedValue(
      decided('refused'),
    );

    await press('Aprobă');

    expect(text(state())).toBe('Refuzată');
  });

  it('re-reads on a live decision about this approval', async () => {
    await open(approval());
    api['assistantApprovalsControllerGet']?.mockResolvedValue(
      decided('expired', { code: 'timeout' }),
    );

    events.next({
      at: '2026-10-29T10:30:00.000Z',
      id: ID,
      kind: 'assistant_approval.decided',
    });
    await new Promise((r) => setTimeout(r, 350));
    await settle();

    expect(text(state())).toBe('Expirată');
  });

  it('after a decision, goes on to the next pending approval', async () => {
    await open(approval());
    api['assistantApprovalsControllerGet']?.mockResolvedValue(
      decided('refused'),
    );
    api['assistantApprovalsControllerList']?.mockResolvedValue({
      items: [approval({ id: 'ap-2' })],
      pending: 1,
    });
    await press('Refuză');

    await press('Gata');

    await expect(result).resolves.toBe('ap-2');
  });

  it('after the last decision, closes', async () => {
    await open(approval());
    api['assistantApprovalsControllerGet']?.mockResolvedValue(
      decided('refused'),
    );
    await press('Refuză');

    await press('Gata');

    // Nothing to go on to: the overlay closes as a dismissal does.
    await expect(result).resolves.toBe('cancelled');
  });
});
