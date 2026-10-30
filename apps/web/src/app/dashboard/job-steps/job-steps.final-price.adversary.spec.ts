import { TestBed } from '@angular/core/testing';
import { FINAL_PRICE_CORRECTION_HOURS } from '@motor-fix/contracts/request-status';

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
const handedOver = (at: string, bani: number | null = 125050) => ({
  ...done,
  finalPriceBani: bani,
  handedOverAt: at,
});
const line = (element: HTMLElement) =>
  text(element.querySelector('[data-final-price]'));
const emit = (
  kind: 'job.handed_over' | 'job.final_price_corrected' | 'job.done',
) => events.next({ at: '2026-10-30T07:00:00.000Z', id: 'job-1', kind });

// @traces 1393-FR-001
// @traces 1393-FR-002
describe('Predare pressed hard', () => {
  it('leaves the drawer as it was when the dialog is cancelled', async () => {
    const { element, settle } = await render({ job: done });
    button(element, 'Predare')?.click();
    await settle();
    await wait(0);
    await settle();

    expect(button(element, 'Predare')).toBeDefined();
    expect(element.querySelector('[data-final-price]')).toBeNull();
    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(1);
  });

  it('puts Predare in the markup before the steps', async () => {
    const { element } = await render({ job: done });
    const predare = button(element, 'Predare') as HTMLElement;
    const firstStep = element.querySelector('[data-step]') as HTMLElement;

    expect(
      predare.compareDocumentPosition(firstStep) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('offers no Predare on a cancelled job', async () => {
    const { element } = await render({ job: { status: 'cancelled' } });

    expect(button(element, 'Predare')).toBeUndefined();
  });
});

// @traces 1393-FR-006
// @traces 1393-FR-008
describe('the final price line under hostile data', () => {
  it('prints no null, NaN or undefined when the price is missing on a handed over job', async () => {
    const { element } = await render({ job: handedOver(ago(HOUR), null) });

    expect(text(element)).not.toMatch(/NaN|undefined|null/);
  });

  it('shows the largest price in full', async () => {
    const { element } = await render({
      job: handedOver(ago(HOUR), 100_000_000),
    });

    expect(line(element)).toContain('Preț final 1.000.000 lei');
  });

  it('shows the smallest price as bani', async () => {
    const { element } = await render({
      job: handedOver(ago(HOUR), 1),
      language: 'en',
    });

    expect(line(element)).toContain('Final price 0.01 lei');
  });

  it('shows the line on a reopened job that still carries a handover', async () => {
    const { element } = await render({
      job: { ...handedOver(ago(HOUR)), status: 'in_work' },
    });

    expect(line(element)).toContain('Preț final 1.250,50 lei');
  });

  it('offers a mechanic the line and nothing to press when the window is open', async () => {
    const { element } = await render({
      job: handedOver(ago(HOUR)),
      role: 'mechanic',
    });

    expect(button(element, 'Corectează')).toBeUndefined();
    expect(button(element, 'Predare')).toBeUndefined();
    expect(element.querySelector('input')).toBeNull();
  });

  it('offers a receptionist Corectează one minute before the window closes and not one minute after', async () => {
    const edge = FINAL_PRICE_CORRECTION_HOURS * HOUR;
    const inside = await render({
      job: handedOver(ago(edge - 60_000)),
      role: 'receptionist',
    });
    expect(button(inside.element, 'Corectează')).toBeDefined();
    TestBed.resetTestingModule();
    const outside = await render({
      job: handedOver(ago(edge + 60_000)),
      role: 'receptionist',
    });
    expect(button(outside.element, 'Corectează')).toBeUndefined();
    expect(line(outside.element)).toContain('Preț final');
  });

  it('drops Corectează after a re-read finds the window closed', async () => {
    const edge = FINAL_PRICE_CORRECTION_HOURS * HOUR;
    const { element, settle } = await render({
      job: handedOver(ago(edge - 1_000)),
    });
    expect(button(element, 'Corectează')).toBeDefined();
    serve(job(handedOver(ago(edge + 5_000))));
    emit('job.final_price_corrected');
    await wait(400);
    await settle();

    expect(button(element, 'Corectează')).toBeUndefined();
    expect(line(element)).toContain('Preț final 1.250,50 lei');
  });

  it('shows the answer of a correction and offers the button again', async () => {
    const { element, settle } = await render({ job: handedOver(ago(HOUR)) });
    overlays.open.mockResolvedValue(job(handedOver(ago(HOUR), 115000)));
    button(element, 'Corectează')?.click();
    await settle();
    await wait(0);
    await settle();

    expect(button(element, 'Corectează')).toBeDefined();
  });
});

// @traces 1393-FR-011
describe('the drawer and a burst of events', () => {
  it('reads once for a burst of handover and correction events', async () => {
    const { settle } = await render({ job: done });
    for (let i = 0; i < 5; i++) emit('job.handed_over');
    emit('job.final_price_corrected');
    await wait(400);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
  });

  it('drops Predare when another person hands the job over', async () => {
    const { element, settle } = await render({ job: done });
    serve(job(handedOver(ago(0))));
    emit('job.handed_over');
    await wait(400);
    await settle();

    expect(button(element, 'Predare')).toBeUndefined();
    expect(button(element, 'Corectează')).toBeDefined();
  });

  it('offers no Predare after a re-read finds the job reopened', async () => {
    const { element, settle } = await render({ job: done });
    serve(job({ status: 'in_work' }));
    emit('job.done');
    await wait(400);
    await settle();

    expect(button(element, 'Predare')).toBeUndefined();
  });
});
