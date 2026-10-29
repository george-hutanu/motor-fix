import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type AssistantActionApprovalDto,
  type AssistantActionApprovalListDto,
  MeService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { ApprovalStrip } from './approval-strip';
import { Live } from '../../dashboard/live';

// @traces 1254-FR-010

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const approval = (id: string): AssistantActionApprovalDto => ({
  assistantName: 'Claude',
  createdAt: '2026-10-29T10:00:00.000Z',
  decidedAt: null,
  expiresAt: '2026-10-29T10:30:00.000Z',
  id,
  kind: 'book',
  options: [],
  outcome: null,
  status: 'pending',
  summary: 'Programează schimbul de ulei joi la 10:00.',
  tool: 'book_service',
});

const waiting = (...ids: string[]): AssistantActionApprovalListDto => ({
  items: ids.map((id) => approval(id)),
  pending: ids.length,
});

let events: Subject<LiveMessage>;
let list: jest.Mock;

async function render(answer: AssistantActionApprovalListDto, language = 'ro') {
  events = new Subject();
  list = jest.fn(async () => answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: MeService,
        useValue: { assistantApprovalsControllerList: list },
      },
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
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(ApprovalStrip);
  await settle(fixture);
  return { element: fixture.nativeElement as HTMLElement, fixture };
}

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const link = (element: HTMLElement) => element.querySelector('a');
const text = (element: HTMLElement) =>
  (link(element)?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

describe('ApprovalStrip', () => {
  it.each([
    [['a1'], '1 acțiune așteaptă aprobarea ta'],
    [['a1', 'a2'], '2 acțiuni așteaptă aprobarea ta'],
    [
      Array.from({ length: 20 }, (_, i) => `a${i}`),
      '20 de acțiuni așteaptă aprobarea ta',
    ],
  ])('counts %j pending in Romanian as "%s"', async (ids, line) => {
    const { element } = await render(waiting(...ids));

    expect(text(element)).toBe(line);
  });

  it('counts in English', async () => {
    const one = await render(waiting('a1'), 'en');
    expect(text(one.element)).toBe('1 action awaits your approval');
    TestBed.resetTestingModule();

    const two = await render(waiting('a1', 'a2'), 'en');
    expect(text(two.element)).toBe('2 actions await your approval');
  });

  it('shows nothing when no approval is pending', async () => {
    const { element } = await render({
      items: [],
      pending: 0,
    });

    expect(link(element)).toBeNull();
    expect(element.textContent?.trim()).toBe('');
  });

  it("links to the oldest pending approval's sheet", async () => {
    const { element } = await render(waiting('oldest', 'newer'));

    expect(link(element)?.getAttribute('href')).toBe(
      '/app/assistant/approvals/oldest',
    );
  });

  it.each(['assistant_approval.requested', 'assistant_approval.decided'])(
    'reads the count again on %s',
    async (kind) => {
      const { element, fixture } = await render(waiting('a1'));
      list.mockResolvedValue(waiting('a1', 'a2'));

      events.next({ at: '2026-10-29T10:01:00.000Z', id: 'a2', kind });
      await wait(350);
      await settle(fixture);

      expect(list).toHaveBeenCalledTimes(2);
      expect(text(element)).toBe('2 acțiuni așteaptă aprobarea ta');
    },
  );

  it('goes away when the last pending approval is decided elsewhere', async () => {
    const { element, fixture } = await render(waiting('a1'));
    list.mockResolvedValue({ items: [], pending: 0 });

    events.next({
      at: '2026-10-29T10:01:00.000Z',
      id: 'a1',
      kind: 'assistant_approval.decided',
    });
    await wait(350);
    await settle(fixture);

    expect(link(element)).toBeNull();
  });
});
