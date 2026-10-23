import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type DocumentCycleDto,
  GaragesService,
  type LegalCheckDto,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { GarageLegalCheck } from './garage-legal-check';
import { DocumentsUpload } from '../documents-upload/documents-upload';
import { fakeLive, wait } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

const CYCLE: DocumentCycleDto = {
  canUpload: true,
  dueOn: '2027-01-15',
  graceUntil: null,
  inReview: false,
  refusal: null,
  row: 'due',
  state: 'due',
};

const ANSWER: LegalCheckDto = {
  companyName: 'ATELIER DINAMO SRL',
  documents: CYCLE,
  isMobile: false,
  lastCheckedOn: '2026-10-01',
  latestRecheck: null,
  rarActivities: [],
  rows: (['company', 'caen', 'rar', 'documents'] as const).map((kind) => ({
    checkedOn: '2026-10-01',
    detail: null,
    kind,
    missing: [],
    state: kind === 'documents' ? ('warning' as const) : ('ok' as const),
  })),
  status: 'approved',
};

const ME = {
  capabilities: ['garage.requests', 'garage.schedule', 'garage.team'],
  garageAccess: [{ garageId: 'garage-1', role: 'owner', status: 'approved' }],
  garageId: 'garage-1',
} as unknown as MeDto;

let read: jest.Mock;
let open: jest.Mock;
let live: ReturnType<typeof fakeLive>;

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(0);
  }
}

async function render(result: unknown = 'cancelled') {
  read = jest.fn(() => Promise.resolve(ANSWER));
  open = jest.fn(() => Promise.resolve(result));
  live = fakeLive();
  const me = signal(ME);
  TestBed.configureTestingModule({
    providers: [
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: GaragesService, useValue: { legalCheckControllerRead: read } },
      { provide: Overlays, useValue: { open } },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  const fixture = TestBed.createComponent(GarageLegalCheck);
  await settle(fixture);
  return fixture;
}

const button = (element: HTMLElement) =>
  element.querySelector<HTMLButtonElement>('[data-documents-upload]');

afterEach(() => TestBed.resetTestingModule());

// @traces 068-FR-005
describe('the yearly documents on the owner’s legal check, live', () => {
  it.each([
    'document.overdue',
    'document.accepted',
    'document.refused',
  ] as const)('reads the panel again on %s for the garage', async (kind) => {
    const fixture = await render();
    expect(read).toHaveBeenCalledTimes(1);

    live.emit(kind, 'garage-1');
    await wait(350);
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
  });
});

// @traces 068-FR-006
describe('the upload dialog from the Documente row', () => {
  it('opens for the garage', async () => {
    const fixture = await render();

    button(fixture.nativeElement)?.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledWith(
      DocumentsUpload,
      expect.objectContaining({
        data: { garageId: 'garage-1' },
        shape: 'dialog',
        title: 'garage.legal.upload.title',
      }),
    );
  });

  it('reads the panel again once the documents are sent', async () => {
    const fixture = await render({
      ...CYCLE,
      inReview: true,
      row: 'in_review',
    });

    button(fixture.nativeElement)?.click();
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads nothing again when the dialog is closed unsent', async () => {
    const fixture = await render('cancelled');

    button(fixture.nativeElement)?.click();
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
