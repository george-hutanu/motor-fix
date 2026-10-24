import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type AdminAccountPageDto,
  AdminService,
  type AuditEntryDto,
  AuditHistoryService,
  VerificationDocumentsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { AdminAccount, type AdminAccountResult } from './admin-account';

// @traces 003-FR-011 003-FR-013 003-FR-017 003-FR-018 003-FR-019

@Component({ template: '<button id="opener">open</button>' })
class Host {
  readonly overlays = inject(Overlays);
}

const page = (
  extra: Partial<AdminAccountPageDto> = {},
): AdminAccountPageDto => ({
  counts: { cars: 2, requests: 4, reviews: 1 },
  createdAt: '2026-03-12T09:14:00.000Z',
  documents: [],
  email: 'radu@example.test',
  garage: null,
  id: 'acc-1',
  isAdmin: false,
  isOwner: false,
  language: 'ro',
  lastActiveAt: '2026-10-20T08:00:00.000Z',
  name: 'Radu <i>Ionescu</i>',
  phone: '+40712345678',
  roles: ['driver'],
  signInMethods: ['password', 'google'],
  status: 'active',
  suspendedReason: null,
  ...extra,
});

const entry = (
  n: number,
  extra: Partial<AuditEntryDto> = {},
): AuditEntryDto => ({
  action: 'update',
  actor: { id: 'adm-1', name: 'Ana', role: 'admin' } as AuditEntryDto['actor'],
  at: '2026-10-21T10:30:00.000Z',
  carId: null,
  field: 'status',
  garageId: null,
  id: `e-${n}`,
  internal: false,
  jobId: null,
  kind: 'account_suspended',
  newValue: 'suspended',
  oldValue: 'active',
  subjectId: 'acc-1',
  subjectType: 'account',
  text: 'Cereri false repetate',
  viaAssistant: false,
  ...extra,
});

let read: jest.Mock;
let history: jest.Mock;
let pageAddress: jest.Mock;
let changed: jest.Mock;
let result: Promise<OverlayResult<AdminAccountResult>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  account: AdminAccountPageDto | HttpErrorResponse = page(),
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(async () => {
    if (account instanceof HttpErrorResponse) throw account;
    return account;
  });
  history ??= jest.fn(async () => ({ items: [], nextCursor: null, total: 0 }));
  pageAddress = jest.fn(async () => ({ url: 'https://files.test/p1' }));
  changed = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AdminService, useValue: { accountControllerRead: read } },
      {
        provide: AuditHistoryService,
        useValue: { auditHistoryControllerList: history },
      },
      {
        provide: VerificationDocumentsService,
        useValue: { legalDocumentsControllerPageAddress: pageAddress },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  document.body.append(host.nativeElement);
  (host.nativeElement.querySelector('#opener') as HTMLElement).focus();
  result = host.componentInstance.overlays.open(AdminAccount, {
    data: { changed, id: 'acc-1' },
    shape: 'drawer',
    title: 'admin.users.account.details',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = () =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].map((b) =>
    text(b),
  );
const button = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;
const value = (label: string) => {
  const term = [...panel().querySelectorAll('dt')].find(
    (dt) => text(dt) === label,
  );
  return text(term?.nextElementSibling ?? null);
};

beforeEach(() => {
  history = undefined as unknown as jest.Mock;
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('the account drawer', () => {
  it('reads the account and shows its labelled details', async () => {
    await open();

    expect(read).toHaveBeenCalledWith({ id: 'acc-1' });
    expect(value('E‑mail')).toBe('radu@example.test');
    expect(value('Telefon')).toBe('+40712345678');
    expect(value('Limba')).toBe('română');
    expect(value('Roluri')).toBe('șofer');
    expect(value('Stare')).toContain('activ');
    expect(panel().querySelector('mf-lamp')).not.toBeNull();
  });

  it('lists the sign-in methods', async () => {
    await open();

    const methods = [
      ...panel().querySelectorAll('[data-part="methods"] li'),
    ].map((li) => text(li));
    expect(methods).toEqual(['E‑mail și parolă', 'Google']);
  });

  it('never renders the typed name or reason as markup', async () => {
    await open(
      page({ status: 'suspended', suspendedReason: '<b>Fraudă</b> repetată' }),
    );

    expect(text()).toContain('Radu <i>Ionescu</i>');
    expect(text()).toContain('<b>Fraudă</b> repetată');
    expect(panel().querySelector('i, b')).toBeNull();
  });

  it('shows the reason under a suspended state and offers Reactivează instead of Suspendă', async () => {
    await open(page({ status: 'suspended', suspendedReason: 'Cereri false' }));

    expect(value('Motivul suspendării')).toBe('Cereri false');
    expect(buttons()).toEqual(
      expect.arrayContaining(['Resetează accesul', 'Reactivează']),
    );
    expect(buttons()).not.toContain('Suspendă');
  });

  it('offers the three actions on an active account', async () => {
    await open();

    expect(buttons()).toEqual(
      expect.arrayContaining([
        'Resetează accesul',
        'Suspendă',
        'Șterge la cererea titularului',
      ]),
    );
  });

  it('offers no action on an admin account', async () => {
    await open(page({ isAdmin: true, roles: ['admin'] }));

    expect(buttons()).not.toContain('Resetează accesul');
    expect(buttons()).not.toContain('Suspendă');
    expect(buttons()).not.toContain('Șterge la cererea titularului');
    expect(text()).toContain('Cont de administrator');
  });

  it("disables an owner's delete and says why", async () => {
    await open(
      page({
        garage: {
          id: 'g-1',
          name: 'Auto Sud',
          relation: 'owner',
          status: 'approved',
        },
        isOwner: true,
        roles: ['garage'],
      }),
    );

    const remove = button('Șterge la cererea titularului');
    expect(remove.disabled).toBe(true);
    const why = panel().querySelector(
      `#${remove.getAttribute('aria-describedby')}`,
    );
    expect(text(why)).toBe('Garajul se închide mai întâi prin suport');
  });

  it('says a suspended garage is handled from its own page and links there', async () => {
    await open(
      page({
        garage: {
          id: 'g-1',
          name: 'Auto Sud',
          relation: 'owner',
          status: 'suspended',
        },
        isOwner: true,
        roles: ['garage'],
      }),
    );

    expect(text()).toContain('Service‑ul este suspendat');
    const link = [...panel().querySelectorAll('a')].find(
      (a) => text(a) === 'Deschide pagina service‑ului',
    );
    expect(link?.getAttribute('href')).toBe('/app/admin/garages');
  });

  it("opens a garage owner's document page in a new tab", async () => {
    const tab = { close: jest.fn(), location: { href: '' }, opener: {} };
    const opened = jest
      .spyOn(window, 'open')
      .mockReturnValue(tab as unknown as Window);
    await open(
      page({
        documents: [
          {
            id: 'd-1',
            kind: 'onrc_certificate',
            pages: 1,
            verificationFileId: 'f-1',
          },
        ],
        garage: {
          id: 'g-1',
          name: 'Auto Sud',
          relation: 'owner',
          status: 'approved',
        },
        isOwner: true,
        roles: ['garage'],
      }),
    );

    button('Certificatul ONRC').click();
    await settle();

    expect(opened).toHaveBeenCalledWith('', '_blank');
    expect(pageAddress).toHaveBeenCalledWith({
      documentId: 'd-1',
      id: 'f-1',
      n: '1',
    });
    expect(tab.location.href).toBe('https://files.test/p1');
    expect(tab.opener).toBeNull();
    opened.mockRestore();
  });

  it('shows the not-found text for an unknown account', async () => {
    await open(new HttpErrorResponse({ status: 404 }));

    expect(text()).toContain('Contul nu există sau a fost șters.');
    expect(buttons()).not.toContain('Suspendă');
  });

  it('reads in English', async () => {
    await open(page(), 'en');

    expect(value('Language')).toBe('Romanian');
    expect(buttons()).toEqual(
      expect.arrayContaining([
        'Reset access',
        'Suspend',
        "Delete at the holder's request",
      ]),
    );
  });
});

describe("the account's history", () => {
  it('reads 50 from the joined time and shows who, what, when and the change', async () => {
    history = jest.fn(async () => ({
      items: [entry(1)],
      nextCursor: null,
      total: 1,
    }));
    await open();

    expect(history).toHaveBeenCalledWith({
      accountId: 'acc-1',
      from: '2026-03-12T09:14:00.000Z',
      limit: 50,
    });
    const line = text(panel().querySelector('[data-part="history"] li'));
    expect(line).toContain('Ana · a suspendat contul ·');
    expect(line).toContain('active → suspended');
    expect(line).toContain('Cereri false repetate');
  });

  it('shows the empty text when nothing is recorded', async () => {
    await open();

    expect(text(panel().querySelector('[data-part="history"]'))).toContain(
      'Nicio înregistrare încă',
    );
  });

  it('reads the next page on Mai multe', async () => {
    history = jest
      .fn()
      .mockResolvedValueOnce({ items: [entry(1)], nextCursor: 'c-2', total: 2 })
      .mockResolvedValueOnce({ items: [entry(2)], nextCursor: null, total: 2 });
    await open();

    button('Mai multe').click();
    await settle();

    expect(history).toHaveBeenLastCalledWith({
      accountId: 'acc-1',
      cursor: 'c-2',
      from: '2026-03-12T09:14:00.000Z',
      limit: 50,
    });
    expect(panel().querySelectorAll('[data-part="history"] li')).toHaveLength(
      2,
    );
    expect(buttons()).not.toContain('Mai multe');
  });
});

describe('after an action', () => {
  async function act(name: string, answer: string) {
    const spy = jest
      .spyOn(TestBed.inject(Overlays), 'open')
      .mockImplementationOnce(async () => answer as never);
    button(name).click();
    await settle();
    spy.mockRestore();
  }

  it('re-reads the account, tells the list and announces the result politely', async () => {
    await open();
    read.mockResolvedValue(
      page({ status: 'suspended', suspendedReason: 'Cereri false' }),
    );

    await act('Suspendă', 'done');

    expect(read).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalled();
    const said = panel().querySelector('[aria-live="polite"]');
    expect(text(said)).toBe('Contul a fost suspendat');
    expect(buttons()).toContain('Reactivează');
  });

  it('says the e-mail failed after a reset whose e-mail was refused', async () => {
    await open();

    await act('Resetează accesul', 'email_failed');

    expect(text(panel().querySelector('[aria-live="polite"]'))).toBe(
      'E‑mailul nu a putut fi trimis',
    );
    expect(button('Resetează accesul').disabled).toBe(false);
  });

  it('re-reads and says the account changed after a stale answer', async () => {
    await open();

    await act('Suspendă', 'stale');

    expect(read).toHaveBeenCalledTimes(2);
    expect(text(panel().querySelector('[aria-live="polite"]'))).toBe(
      'Contul s‑a schimbat între timp',
    );
  });

  it('closes with deleted after a delete', async () => {
    await open();

    await act('Șterge la cererea titularului', 'done');

    await expect(result).resolves.toBe('deleted');
  });

  it('does nothing when the dialog is cancelled', async () => {
    await open();

    await act('Suspendă', 'cancelled');

    expect(read).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });
});
