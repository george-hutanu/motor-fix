import { TestBed } from '@angular/core/testing';
import { FINAL_PRICE_CORRECTION_HOURS } from '@motor-fix/contracts/request-status';

import { FinalPriceDialog } from './final-price-dialog/final-price-dialog';
import {
  api,
  button,
  events,
  job,
  overlays,
  render,
  serve,
  text,
  wait,
} from './job-steps.testing';

afterEach(() => TestBed.resetTestingModule());

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const done = { status: 'done' as const };
const handedOver = (at: string, bani = 125050) => ({
  ...done,
  finalPriceBani: bani,
  handedOverAt: at,
});
const line = (element: HTMLElement) =>
  text(element.querySelector('[data-final-price]'));

// @traces 1393-FR-001
// @traces 1410-FR-001
// @traces 1393-FR-005
// @traces 1393-FR-008
// @traces 1393-FR-017
describe('Predare in the job drawer', () => {
  it.each(['garage', 'receptionist'] as const)(
    'offers %s Predare on a done job',
    async (role) => {
      const { element } = await render({ job: done, role });

      expect(button(element, 'Predare')).toBeDefined();
      expect(element.querySelector('[data-final-price]')).toBeNull();
    },
  );

  it.each([
    ['a mechanic on a done job', { job: done, role: 'mechanic' as const }],
    ['a job still in work', { job: { status: 'in_work' as const } }],
    [
      'a job already handed over',
      { job: handedOver(ago(72 * HOUR)), role: 'receptionist' as const },
    ],
  ])('offers no Predare to %s', async (_case, options) => {
    const { element } = await render(options);

    expect(button(element, 'Predare')).toBeUndefined();
    expect(element.querySelector('input')).toBeNull();
  });

  it('reads Handover in English', async () => {
    const { element } = await render({ job: done, language: 'en' });

    expect(button(element, 'Handover')).toBeDefined();
  });

  it('opens the dialog over the drawer for this job', async () => {
    const { element, settle } = await render({ job: done });
    button(element, 'Predare')?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      FinalPriceDialog,
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-1',
          quoteFromBani: 89000,
          quoteToBani: 140000,
          recorded: null,
        }),
        shape: 'dialog',
        title: 'garage.jobs.finalPrice.handover',
      }),
    );
  });

  it('shows the price the dialog answered at once, without a re-read', async () => {
    const { element, settle } = await render({ job: done });
    overlays.open.mockResolvedValue(job(handedOver(ago(0))));
    button(element, 'Predare')?.click();
    await settle();
    await wait(0);
    await settle();

    expect(line(element)).toContain('Preț final 1.250,50 lei');
    expect(button(element, 'Predare')).toBeUndefined();
    expect(button(element, 'Corectează')).toBeDefined();
    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(1);
  });

  it('re-reads the job when the dialog asks it to', async () => {
    const { element, settle } = await render({ job: done });
    button(element, 'Predare')?.click();
    await settle();
    const { data } = overlays.open.mock.calls[0][1];
    serve(job(handedOver(ago(HOUR))));
    data.reread();
    await wait(0);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
    expect(line(element)).toContain('Preț final 1.250,50 lei');
  });
});

// @traces 1393-FR-006
// @traces 1393-FR-008
// @traces 1393-FR-017
describe('the final price line', () => {
  it.each(['garage', 'receptionist'] as const)(
    'offers %s Corectează inside the window, pre-filled',
    async (role) => {
      const inside = FINAL_PRICE_CORRECTION_HOURS * HOUR - 60_000;
      const { element, settle } = await render({
        job: handedOver(ago(inside)),
        role,
      });

      expect(line(element)).toContain('Preț final 1.250,50 lei');
      button(element, 'Corectează')?.click();
      await settle();
      expect(overlays.open).toHaveBeenCalledWith(
        FinalPriceDialog,
        expect.objectContaining({
          data: expect.objectContaining({
            jobId: 'job-1',
            quoteFromBani: 89000,
            quoteToBani: 140000,
            recorded: 125050,
          }),
          title: 'garage.jobs.finalPrice.correctTitle',
        }),
      );
    },
  );

  it('shows the line alone once the window has closed', async () => {
    const { element } = await render({
      job: handedOver(ago(FINAL_PRICE_CORRECTION_HOURS * HOUR)),
    });

    expect(line(element)).toContain('Preț final 1.250,50 lei');
    expect(button(element, 'Corectează')).toBeUndefined();
  });

  it('shows a mechanic the line and no control', async () => {
    const { element } = await render({
      job: handedOver(ago(HOUR)),
      role: 'mechanic',
    });

    expect(line(element)).toContain('Preț final 1.250,50 lei');
    expect(button(element, 'Corectează')).toBeUndefined();
    expect(button(element, 'Predare')).toBeUndefined();
  });

  it('reads in English', async () => {
    const { element } = await render({
      job: handedOver(ago(HOUR)),
      language: 'en',
    });

    expect(line(element)).toContain('Final price 1,250.50 lei');
    expect(button(element, 'Correct')).toBeDefined();
  });

  it('shows the corrected price the dialog answered', async () => {
    const { element, settle } = await render({ job: handedOver(ago(HOUR)) });
    overlays.open.mockResolvedValue(job(handedOver(ago(HOUR), 115000)));
    button(element, 'Corectează')?.click();
    await settle();
    await wait(0);
    await settle();

    expect(line(element)).toContain('Preț final 1.150 lei');
  });
});

// @traces 1393-FR-011
describe('the drawer and the final price events', () => {
  it.each(['job.handed_over', 'job.final_price_corrected'] as const)(
    're-reads on %s',
    async (kind) => {
      const { element, settle } = await render({ job: done });
      serve(job(handedOver(ago(0))));
      events.next({ at: '2026-10-30T07:00:00.000Z', id: 'job-1', kind });
      await wait(400);
      await settle();

      expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
      expect(line(element)).toContain('Preț final 1.250,50 lei');
    },
  );
});
