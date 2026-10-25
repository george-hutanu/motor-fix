import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type DataExportDto, MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { DataExport } from './data-export';
import en from '../../../../../../libs/i18n/src/shell/en.json';
import ro from '../../../../../../libs/i18n/src/shell/ro.json';

// @traces 140-FR-009 140-FR-015

const RO = ro.dataExport;
const EN = en.dataExport;

const AT = '2026-10-24T09:00:00.000Z';

const row = (patch: Partial<DataExportDto>): DataExportDto => ({
  canRequestAt: null,
  expiresAt: null,
  readyAt: null,
  requestedAt: AT,
  status: 'queued',
  ...patch,
});

const refusal = (status: number, code: string) =>
  new HttpErrorResponse({
    error: { code, message: code },
    status,
    url: '/api/v1/me/data-export',
  });

let latest: jest.Mock;
let request: jest.Mock;
let download: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function render(
  answers: Array<DataExportDto | null | HttpErrorResponse>,
  language: 'ro' | 'en' = 'ro',
) {
  latest = jest.fn();
  for (const answer of answers) {
    if (answer instanceof HttpErrorResponse)
      latest.mockRejectedValueOnce(answer);
    else latest.mockResolvedValueOnce(answer);
  }
  request = jest.fn();
  download = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MeService,
        useValue: {
          dataExportControllerDownload$Response: download,
          dataExportControllerLatest: latest,
          dataExportControllerRequest: request,
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(DataExport);
  fixture.autoDetectChanges();
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const button = (element: HTMLElement) =>
  element.querySelector('button.request') as HTMLButtonElement | null;
const link = (element: HTMLElement) =>
  element.querySelector('button.download') as HTMLButtonElement | null;
const status = (element: HTMLElement) =>
  element.querySelector('[role="status"]') as HTMLElement;
const text = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ');

describe('"Descarcă datele mele" under unusual server answers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the button enabled for a failed row even if canRequestAt is in the future', async () => {
    const element = await render([
      row({ canRequestAt: '2026-10-25T09:00:00.000Z', status: 'failed' }),
    ]);

    expect(button(element)?.disabled).toBe(false);
    expect(text(element)).not.toContain(RO.tooSoon);
    expect(status(element).textContent).toContain(RO.failed);
  });

  it('lets a ready row win over canRequestAt and shows no once-a-day line', async () => {
    const element = await render([
      row({
        canRequestAt: '2026-10-25T09:00:00.000Z',
        expiresAt: '2026-10-31T10:00:00.000Z',
        status: 'ready',
      }),
    ]);

    expect(button(element)).toBeNull();
    expect(text(element)).not.toContain(RO.tooSoon);
  });

  it('shows the queued line with no button when a queued row has no canRequestAt', async () => {
    const element = await render([
      row({ canRequestAt: null, status: 'queued' }),
    ]);

    expect(status(element).textContent).toContain(RO.queued);
    expect(button(element)).toBeNull();
  });

  it('never prints Invalid Date or undefined for a ready row without an expiry', async () => {
    const element = await render([row({ expiresAt: null, status: 'ready' })]);

    expect(text(element)).not.toContain('Invalid');
    expect(text(element)).not.toContain('undefined');
    expect(text(element)).not.toContain('null');
  });

  it('never prints Invalid Date for an unparseable expiry', async () => {
    const element = await render([row({ expiresAt: 'soon', status: 'ready' })]);

    expect(text(element)).not.toContain('Invalid');
  });

  it('downloads under a safe fallback name when the server sends no content-disposition', async () => {
    const element = await render([
      row({ expiresAt: '2026-10-31T10:00:00.000Z', status: 'ready' }),
    ]);
    download.mockResolvedValueOnce({
      body: new Blob(['zip']),
      headers: new Headers(),
    });
    const names: string[] = [];
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
    Object.assign(URL, {
      createObjectURL: jest.fn(() => 'blob:zip'),
      revokeObjectURL: jest.fn(),
    });

    link(element)?.click();
    await settle();

    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\.zip$/);
  });

  it('does not take a path from a hostile content-disposition filename', async () => {
    const element = await render([
      row({ expiresAt: '2026-10-31T10:00:00.000Z', status: 'ready' }),
    ]);
    download.mockResolvedValueOnce({
      body: new Blob(['zip']),
      headers: new Headers({
        'content-disposition': 'attachment; filename="../../etc/passwd"',
      }),
    });
    const names: string[] = [];
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
    Object.assign(URL, {
      createObjectURL: jest.fn(() => 'blob:zip'),
      revokeObjectURL: jest.fn(),
    });

    link(element)?.click();
    await settle();

    expect(names[0]).not.toContain('/');
  });

  it('revokes the object URL after saving the file', async () => {
    const element = await render([
      row({ expiresAt: '2026-10-31T10:00:00.000Z', status: 'ready' }),
    ]);
    download.mockResolvedValueOnce({
      body: new Blob(['zip']),
      headers: new Headers(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const revoke = jest.fn();
    Object.assign(URL, {
      createObjectURL: jest.fn(() => 'blob:zip'),
      revokeObjectURL: revoke,
    });

    link(element)?.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(revoke).toHaveBeenCalledWith('blob:zip');
  });

  it('sends one download call for a double press', async () => {
    const element = await render([
      row({ expiresAt: '2026-10-31T10:00:00.000Z', status: 'ready' }),
    ]);
    let done: (value: unknown) => void = () => undefined;
    download.mockReturnValueOnce(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.assign(URL, {
      createObjectURL: jest.fn(() => 'blob:zip'),
      revokeObjectURL: jest.fn(),
    });

    link(element)?.click();
    await settle();
    link(element)?.click();
    await settle();
    done({ body: new Blob(['z']), headers: new Headers() });
    await settle();

    expect(download).toHaveBeenCalledTimes(1);
  });

  it('shows the generic task error for a failed request that carries no error body', async () => {
    const element = await render([null]);
    request.mockRejectedValueOnce(new Error('offline'));

    button(element)?.click();
    await settle();

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(element)).not.toContain('undefined');
    expect(button(element)?.disabled).toBe(false);
  });

  it('shows the 403 refusal as an error and keeps the state, not the once-a-day line', async () => {
    const element = await render([null]);
    request.mockRejectedValueOnce(refusal(403, 'forbidden'));

    button(element)?.click();
    await settle();

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(element)).not.toContain(RO.tooSoon);
  });

  it('clears an earlier error when a later request succeeds', async () => {
    const element = await render([null]);
    request.mockRejectedValueOnce(refusal(500, 'internal_error'));
    button(element)?.click();
    await settle();
    request.mockResolvedValueOnce(row({ status: 'queued' }));

    button(element)?.click();
    await settle();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(status(element).textContent).toContain(RO.queued);
  });

  it('keeps the live region element in place across every state change', async () => {
    const element = await render([null]);
    const region = status(element);
    request.mockResolvedValueOnce(row({ status: 'queued' }));

    button(element)?.click();
    await settle();

    expect(status(element)).toBe(region);
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('reads English once-a-day and queued lines', async () => {
    const element = await render(
      [row({ canRequestAt: '2026-10-25T09:00:00.000Z', status: 'expired' })],
      'en',
    );

    expect(status(element).textContent).toContain(EN.tooSoon);
    expect(button(element)?.textContent?.trim()).toBe(EN.button);
  });

  it('gives both catalogues the same non-empty dataExport keys', () => {
    expect(Object.keys(RO).sort()).toEqual(Object.keys(EN).sort());
    for (const key of Object.keys(RO) as (keyof typeof RO)[]) {
      expect(String(RO[key]).trim()).not.toBe('');
      expect(String(EN[key]).trim()).not.toBe('');
    }
  });
});
