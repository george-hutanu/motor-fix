import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import {
  api,
  button,
  events,
  input,
  item,
  job,
  menu,
  refused,
  render,
  rows,
  serve,
  text,
  ticks,
  type,
  wait,
  waiting,
} from './job-steps.testing';

afterEach(() => TestBed.resetTestingModule());

describe('a job’s steps under hostile use', () => {
  it('ticks while the job is paused', async () => {
    const { element, settle } = await render({ job: { status: 'paused' } });

    ticks(element)[1].click();
    await settle();

    expect(waiting.add).toHaveBeenCalledTimes(1);
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('gives a receptionist nothing to press on a job not started', async () => {
    const { element } = await render({
      job: { status: 'to_do' },
      role: 'receptionist',
    });

    expect(ticks(element)).toHaveLength(0);
    expect(menu(element, 0)).toBeNull();
    expect(button(element, 'Adaugă un pas')).toBeUndefined();
    expect(rows(element)).toHaveLength(3);
  });

  it('counts 0 din 0 nowhere and hides the counter with no steps', async () => {
    const { element } = await render({
      job: { steps: [], stepsDone: 0, stepsTotal: 0 },
    });

    expect(text(element)).not.toContain('0 din 0');
    expect(text(element)).toContain('Niciun pas încă');
  });

  it('ticks twice quickly and queues the first change only once per press', async () => {
    const { element, settle } = await render();

    ticks(element)[1].click();
    ticks(element)[1].click();
    await settle();

    const bodies = waiting.add.mock.calls.map((c) => c[1].body.done);
    expect(waiting.add).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual([true, false]);
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['two characters', 'ab', true],
    ['eighty characters padded', `  ${'z'.repeat(80)}  `, true],
    ['one character', 'a', false],
    ['spaces only', '        ', false],
    ['eighty one characters', 'z'.repeat(81), false],
  ])('checks %s before adding', async (_name, value, sent) => {
    const { element, settle } = await render();

    button(element, 'Adaugă un pas')?.click();
    await settle();
    type(input(element) as HTMLInputElement, value);
    button(element, 'Adaugă')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).toHaveBeenCalledTimes(sent ? 1 : 0);
    if (sent)
      expect(api['jobStepsControllerAdd'].mock.calls[0][0].body.text).toBe(
        value.trim(),
      );
  });

  it('refuses a one-character rename and sends nothing', async () => {
    const { element, settle } = await render();
    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();

    type(input(element) as HTMLInputElement, ' a ');
    button(element, 'Salvează')?.click();
    await settle();

    expect(api['jobStepsControllerRename']).not.toHaveBeenCalled();
  });

  it('moves the second step up by naming every step once', async () => {
    const { element, settle } = await render();

    menu(element, 1)?.click();
    await settle();
    item('Mută mai sus')?.click();
    await settle();

    expect(api['jobStepsControllerReorder']).toHaveBeenCalledWith({
      body: { stepIds: ['s2', 's1', 's3'] },
      id: 'job-1',
    });
    expect(rows(element).map((r) => r.dataset['step'])).toEqual([
      's2',
      's1',
      's3',
    ]);
  });

  it('puts the order back when the move is refused', async () => {
    const { element, settle } = await render();
    api['jobStepsControllerReorder'].mockRejectedValueOnce(
      refused(400, 'validation_failed', 'Ordinea nu se potrivește'),
    );

    menu(element, 1)?.click();
    await settle();
    item('Mută mai jos')?.click();
    await settle();

    expect(rows(element).map((r) => r.dataset['step'])).toEqual([
      's1',
      's2',
      's3',
    ]);
    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
  });

  it('puts the step back when its removal fails without signal', async () => {
    const { element, settle } = await render();
    api['jobStepsControllerRemove'].mockRejectedValueOnce(
      new HttpErrorResponse({ status: 0 }),
    );

    menu(element, 0)?.click();
    await settle();
    item('Șterge')?.click();
    await settle();

    expect(rows(element)).toHaveLength(3);
    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
  });

  it('uses a different key for each add', async () => {
    const { element, settle } = await render();

    for (const word of ['Primul pas', 'Al doilea']) {
      button(element, 'Adaugă un pas')?.click();
      await settle();
      type(input(element) as HTMLInputElement, word);
      button(element, 'Adaugă')?.click();
      await settle();
    }

    const keys = api['jobStepsControllerAdd'].mock.calls.map(
      (c) => c[0]['Idempotency-Key'],
    );
    expect(new Set(keys).size).toBe(2);
  });

  it('shows a job with no mechanic and no car plate without breaking', async () => {
    const { element } = await render({
      job: { mechanicId: null, mechanicName: null },
    });

    expect(rows(element)).toHaveLength(3);
  });

  it('reads the job again on a stage event about it', async () => {
    const { settle } = await render();

    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.done',
    });
    await wait(400);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
  });

  it('turns read-only when a stage event closes the job', async () => {
    const { element, settle } = await render();
    serve(job({ status: 'done' }));

    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.done',
    });
    await wait(400);
    await settle();

    expect(ticks(element)).toHaveLength(0);
    expect(button(element, 'Adaugă un pas')).toBeUndefined();
  });
});
