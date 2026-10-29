import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { ApprovalPage } from './approval-page';
import { Live } from '../../dashboard/live';
import { Session } from '../../dashboard/session';
import { ApprovalSheet } from '../approval-sheet/approval-sheet';

// @traces 1254-FR-004
// @traces 1254-FR-010

let get: jest.Mock;
let open: jest.Mock;

async function visit(id: string, answers: unknown[]) {
  get = jest.fn(async ({ id }: { id: string }) => {
    if (id === 'gone')
      throw new HttpErrorResponse({
        error: { code: 'not_found' },
        status: 404,
      });
    return { assistantName: id === 'unnamed' ? null : 'Claude', id };
  });
  open = jest.fn();
  for (const answer of answers) open.mockResolvedValueOnce(answer);
  open.mockReturnValue(new Promise(() => undefined));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: ApprovalPage, path: 'app/assistant/approvals/:id' },
        { children: [], path: 'app/driver' },
      ]),
      {
        provide: MeService,
        useValue: { assistantApprovalsControllerGet: get },
      },
      { provide: Overlays, useValue: { open } },
      { provide: Live, useValue: { close: jest.fn(), open: jest.fn() } },
      {
        provide: Session,
        useValue: { load: async () => ({ landing: '/app/driver' }) },
      },
    ],
  });
  await TestBed.inject(I18n).enter('assistant');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/app/assistant/approvals/${id}`);
  for (let i = 0; i < 6; i++) {
    harness.detectChanges();
    await new Promise((r) => setTimeout(r));
  }
  return harness;
}

afterEach(() => TestBed.resetTestingModule());

describe('ApprovalPage', () => {
  it("opens the approval's sheet as a drawer titled with the assistant's name", async () => {
    await visit('ap-1', []);

    expect(open).toHaveBeenCalledWith(ApprovalSheet, {
      data: { id: 'ap-1' },
      shape: 'drawer',
      title: 'assistant.approval.title',
      titleParams: { client: 'Claude' },
    });
  });

  it('titles an unnamed assistant as your assistant', async () => {
    await visit('unnamed', []);

    expect(open.mock.calls[0]?.[1]).toMatchObject({
      title: 'assistant.approval.titleUnnamed',
    });
  });

  it('goes on to the next pending approval, then to the dashboard', async () => {
    await visit('ap-1', ['ap-2', 'cancelled']);

    expect(open.mock.calls.map(([, o]) => o.data.id)).toEqual(['ap-1', 'ap-2']);
    expect(TestBed.inject(Router).url).toBe('/app/driver');
  });

  it("says so for an approval that is not the account's", async () => {
    const harness = await visit('gone', []);

    expect(open).not.toHaveBeenCalled();
    expect(harness.routeNativeElement?.textContent).toContain(
      'Nu am găsit această cerere a asistentului.',
    );
  });
});
