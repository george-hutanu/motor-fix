import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type DataExportDto, MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { DataExport } from './data-export';
import en from '../../../../../../libs/i18n/src/shell/en.json';
import ro from '../../../../../../libs/i18n/src/shell/ro.json';

// @traces 140-FR-009 140-FR-015 140-FR-017

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

describe('"Descarcă datele mele" in the account panel', () => {
  it('heads the row and says what the file holds', async () => {
    const element = await render([null]);

    expect(element.querySelector('h3')?.textContent?.trim()).toBe(RO.title);
    expect(text(element)).toContain(RO.text);
  });

  it('offers the button when there is no export', async () => {
    const element = await render([null]);

    expect(button(element)?.textContent?.trim()).toBe(RO.button);
    expect(button(element)?.disabled).toBe(false);
    expect(link(element)).toBeNull();
  });

  it('offers the button again once the last file has expired', async () => {
    const element = await render([row({ status: 'expired' })]);

    expect(button(element)?.disabled).toBe(false);
    expect(text(element)).not.toContain(RO.tooSoon);
  });

  it('says the file is being prepared while it is queued, with no button', async () => {
    const element = await render([
      row({ canRequestAt: '2026-10-25T09:00:00.000Z', status: 'queued' }),
    ]);

    expect(status(element).textContent).toContain(RO.queued);
    expect(button(element)).toBeNull();
    expect(link(element)).toBeNull();
  });

  it('offers the ZIP with its expiry date and no request button when it is ready', async () => {
    const element = await render([
      row({
        canRequestAt: '2026-10-25T09:00:00.000Z',
        expiresAt: '2026-10-31T10:00:00.000Z',
        readyAt: '2026-10-24T10:00:00.000Z',
        status: 'ready',
      }),
    ]);

    expect(link(element)?.textContent?.trim()).toBe(RO.download);
    expect(text(element)).toContain('Disponibil până pe 31 oct. 2026.');
    expect(button(element)).toBeNull();
    expect(text(element)).not.toContain(RO.tooSoon);
  });

  it('downloads the ZIP through the API client, under the name the server gives', async () => {
    const element = await render([
      row({ expiresAt: '2026-10-31T10:00:00.000Z', status: 'ready' }),
    ]);
    const blob = new Blob(['zip'], { type: 'application/zip' });
    download.mockResolvedValueOnce({
      body: blob,
      headers: new Headers({
        'content-disposition':
          'attachment; filename="motorfix-date-2026-10-24.zip"',
      }),
    });
    const saved: { href: string; download: string }[] = [];
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ download: this.download, href: this.href });
      });
    const created = jest.fn(() => 'blob:zip');
    Object.assign(URL, {
      createObjectURL: created,
      revokeObjectURL: jest.fn(),
    });

    link(element)?.click();
    await settle();

    expect(download).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith(blob);
    expect(saved).toEqual([
      { download: 'motorfix-date-2026-10-24.zip', href: 'blob:zip' },
    ]);
    click.mockRestore();
  });

  it('reloads the state when the file is gone by the time it is asked for', async () => {
    const element = await render([
      row({ expiresAt: '2026-10-31T10:00:00.000Z', status: 'ready' }),
      row({ status: 'expired' }),
    ]);
    download.mockRejectedValueOnce(refusal(404, 'not_found'));

    link(element)?.click();
    await settle();

    expect(latest).toHaveBeenCalledTimes(2);
    expect(link(element)).toBeNull();
    expect(button(element)?.disabled).toBe(false);
  });

  it('says the file failed and offers the button again', async () => {
    const element = await render([row({ status: 'failed' })]);

    expect(status(element).textContent).toContain(RO.failed);
    expect(button(element)?.disabled).toBe(false);
  });

  it('disables the button with the once-a-day line while a request is younger than a day', async () => {
    const element = await render([
      row({ canRequestAt: '2026-10-25T09:00:00.000Z', status: 'expired' }),
    ]);

    expect(button(element)?.disabled).toBe(true);
    expect(status(element).textContent).toContain(RO.tooSoon);
    expect(button(element)?.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('requests the file and shows the queued line in the live region', async () => {
    const element = await render([null]);
    request.mockResolvedValueOnce(
      row({ canRequestAt: '2026-10-25T09:00:00.000Z', status: 'queued' }),
    );
    const region = status(element);
    expect(region.getAttribute('aria-live')).toBe('polite');

    button(element)?.click();
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
    expect(status(element)).toBe(region);
    expect(region.textContent).toContain(RO.queued);
    expect(button(element)).toBeNull();
  });

  it('sends one request for a double press', async () => {
    const element = await render([null]);
    let answer: (value: DataExportDto) => void = () => undefined;
    request.mockReturnValueOnce(
      new Promise<DataExportDto>((resolve) => {
        answer = resolve;
      }),
    );

    button(element)?.click();
    await settle();
    button(element)?.click();
    await settle();
    answer(row({ status: 'queued' }));
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('disables the button with the once-a-day line when the server answers too soon', async () => {
    const element = await render([null]);
    request.mockRejectedValueOnce(refusal(429, 'export_too_soon'));

    button(element)?.click();
    await settle();

    expect(button(element)?.disabled).toBe(true);
    expect(status(element).textContent).toContain(RO.tooSoon);
  });

  it('reloads the state when the server says a file is already ready', async () => {
    const element = await render([
      null,
      row({
        expiresAt: '2026-10-31T10:00:00.000Z',
        readyAt: '2026-10-24T10:00:00.000Z',
        status: 'ready',
      }),
    ]);
    request.mockRejectedValueOnce(refusal(409, 'export_ready'));

    button(element)?.click();
    await settle();

    expect(latest).toHaveBeenCalledTimes(2);
    expect(link(element)?.textContent?.trim()).toBe(RO.download);
    expect(button(element)).toBeNull();
  });

  it('shows the task error next to the button when a request fails', async () => {
    const element = await render([null]);
    request.mockRejectedValueOnce(refusal(500, 'internal_error'));

    button(element)?.click();
    await settle();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      ro.form.problem.internal_error,
    );
    expect(button(element)?.disabled).toBe(false);
  });

  it('shows the task error and a retry, and neither action, when the state cannot be read', async () => {
    const element = await render([refusal(503, 'service_unavailable'), null]);

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      ro.form.problem.service_unavailable,
    );
    expect(button(element)).toBeNull();
    expect(link(element)).toBeNull();
    const retry = element.querySelector('button.retry') as HTMLButtonElement;
    expect(retry.textContent?.trim()).toBe(RO.retry);

    retry.click();
    await settle();

    expect(latest).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(button(element)?.disabled).toBe(false);
  });

  it('reads English, the expiry date in the English way', async () => {
    const element = await render(
      [
        row({
          expiresAt: '2026-10-31T10:00:00.000Z',
          readyAt: '2026-10-24T10:00:00.000Z',
          status: 'ready',
        }),
      ],
      'en',
    );

    expect(element.querySelector('h3')?.textContent?.trim()).toBe(EN.title);
    expect(link(element)?.textContent?.trim()).toBe(EN.download);
    expect(text(element)).toContain('Available until 31 Oct 2026.');
  });
});
