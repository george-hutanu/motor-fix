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
  step,
  text,
  ticks,
  type,
  wait,
  waiting,
} from './job-steps.testing';

afterEach(() => TestBed.resetTestingModule());

// @traces 424-FR-013
describe('a job’s steps', () => {
  it('lists the steps in order with the counter and the job above them', async () => {
    const { element } = await render();

    expect(rows(element).map(text)).toEqual([
      expect.stringContaining('Pas 1'),
      expect.stringContaining('Pas 2'),
      expect.stringContaining('Pas 3'),
    ]);
    const all = text(element);
    expect(all).toContain('Pașii lucrării');
    expect(all).toContain('1 din 3 gata');
    expect(all).toContain('Dacia Logan');
    expect(all).toContain('B 101 QAT');
    expect(ticks(element).map((t) => t.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('says there are no steps yet and offers to add one', async () => {
    const { element } = await render({
      job: { steps: [], stepsDone: 0, stepsTotal: 0 },
    });

    expect(text(element)).toContain('Niciun pas încă');
    expect(button(element, 'Adaugă un pas')).toBeDefined();
  });

  it.each([
    ['the owner', 'garage'],
    ['the job’s mechanic', 'mechanic'],
  ] as const)(
    'gives %s the ticks, the menus and the add row',
    async (_who, role) => {
      const { element } = await render({ role });

      expect(ticks(element)).toHaveLength(3);
      expect(menu(element, 0)).not.toBeNull();
      expect(button(element, 'Adaugă un pas')).toBeDefined();
    },
  );

  it.each([
    ['a receptionist', { role: 'receptionist' as const }],
    ['a done job', { job: { status: 'done' as const } }],
    ['a cancelled job', { job: { status: 'cancelled' as const } }],
  ])('only shows the steps to %s', async (_who, options) => {
    const { element } = await render(options);

    expect(rows(element)).toHaveLength(3);
    expect(ticks(element)).toHaveLength(0);
    expect(menu(element, 0)).toBeNull();
    expect(button(element, 'Adaugă un pas')).toBeUndefined();
  });

  it('stops at 20 steps', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => step(i + 1));
    const { element } = await render({
      job: { steps: twenty, stepsDone: 0, stepsTotal: 20 },
    });

    expect(button(element, 'Adaugă un pas')?.disabled).toBe(true);
    expect(text(element)).toContain('Cel mult 20 de pași');
  });
});

// @traces 424-FR-014
describe('ticking a step', () => {
  it('ticks through the waiting queue and shows it done at once', async () => {
    const { element, settle } = await render();

    ticks(element)[1].click();
    await settle();

    expect(waiting.add).toHaveBeenCalledWith('job.step', {
      body: { done: true },
      method: 'PUT',
      url: '/api/v1/garage/jobs/job-1/steps/s2/done',
    });
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('true');
    expect(text(element)).toContain('2 din 3 gata');
  });

  it('holds a tick while the queue does, and shows the read once it drops it', async () => {
    const { element, settle } = await render();
    const url = '/api/v1/garage/jobs/job-1/steps/s2/done';
    const reread = async () => {
      // Each read is a new answer, as over HTTP.
      serve(job());
      events.next({
        at: '2026-10-09T07:00:00.000Z',
        id: 'job-1',
        kind: 'job.step_done',
      });
      await wait(400);
      await settle();
    };

    ticks(element)[1].click();
    waiting.actions.set([{ key: 'key-1', state: 'waiting', url }]);
    await settle();
    await reread();

    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('true');
    expect(text(rows(element)[1])).toContain('Se trimite');

    // The queue gave up on it: the read, which never saw it done, wins.
    serve(job());
    waiting.actions.set([]);
    await settle();
    await wait(0);
    await settle();

    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('false');
    expect(text(rows(element)[1])).not.toContain('Se trimite');
    expect(text(element)).toContain('1 din 3 gata');
  });

  it('unticks a ticked step the same way', async () => {
    const { element, settle } = await render({ role: 'mechanic' });

    ticks(element)[0].click();
    await settle();

    expect(waiting.add).toHaveBeenCalledWith(
      'job.step',
      expect.objectContaining({ body: { done: false } }),
    );
    expect(text(element)).toContain('0 din 3 gata');
  });

  it('sends nothing on a job not yet started, and says to start it first', async () => {
    const { element, settle } = await render({ job: { status: 'to_do' } });

    ticks(element)[1].click();
    await settle();

    expect(waiting.add).not.toHaveBeenCalled();
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('false');
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Pornește lucrarea mai întâi',
    );
  });

  it('says in English to start the job first', async () => {
    const { element, settle } = await render({
      job: { status: 'to_do' },
      language: 'en',
    });

    ticks(element)[1].click();
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Start the job first',
    );
  });
});

// @traces 424-FR-014 424-FR-016
describe('writing the steps', () => {
  it('adds a step with its own key, after checking its length', async () => {
    const { element, settle } = await render();

    button(element, 'Adaugă un pas')?.click();
    await settle();
    const field = input(element) as HTMLInputElement;
    type(field, '  x ');
    button(element, 'Adaugă')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).not.toHaveBeenCalled();
    expect(text(element)).toContain('Între 2 și 80 de caractere');

    type(field, 'y'.repeat(81));
    button(element, 'Adaugă')?.click();
    await settle();
    expect(api['jobStepsControllerAdd']).not.toHaveBeenCalled();

    type(field, '  Probă pe drum ');
    button(element, 'Adaugă')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).toHaveBeenCalledWith({
      body: { text: 'Probă pe drum' },
      'Idempotency-Key': expect.stringMatching(/.{8,64}/),
      id: 'job-1',
    });
  });

  // @traces 424-FR-014
  it('shows an added step at once, and drops it with a message when refused', async () => {
    const { element, settle } = await render();
    let refuse: ((error: unknown) => void) | undefined;
    api['jobStepsControllerAdd'].mockImplementation(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );

    button(element, 'Adaugă un pas')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Probă pe drum');
    button(element, 'Adaugă')?.click();
    await settle();

    expect(rows(element)).toHaveLength(4);
    expect(text(rows(element)[3])).toContain('Probă pe drum');

    refuse?.(refused(409, 'too_many_steps', 'Cel mult 20 de pași'));
    await wait(0);
    await settle();

    expect(rows(element)).toHaveLength(3);
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Cel mult 20 de pași',
    );
  });

  it('cancels an add without sending it', async () => {
    const { element, settle } = await render();

    button(element, 'Adaugă un pas')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Probă pe drum');
    button(element, 'Anulează')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).not.toHaveBeenCalled();
    expect(input(element)).toBeNull();
  });

  it('renames a step from its menu', async () => {
    const { element, settle } = await render();

    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    const field = input(element) as HTMLInputElement;
    expect(field.value).toBe('Pas 2');
    type(field, 'Etriere scoase');
    button(element, 'Salvează')?.click();
    await settle();

    expect(api['jobStepsControllerRename']).toHaveBeenCalledWith({
      body: { text: 'Etriere scoase' },
      id: 'job-1',
      stepId: 's2',
    });
  });

  it('puts a refused rename back as it was and says why', async () => {
    const { element, settle } = await render();
    api['jobStepsControllerRename'].mockRejectedValue(
      refused(409, 'job_closed', 'Lucrarea e închisă'),
    );

    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Etriere scoase');
    button(element, 'Salvează')?.click();
    await settle();
    await wait(0);
    await settle();

    expect(text(rows(element)[1])).toContain('Pas 2');
    expect(text(rows(element)[1])).not.toContain('Etriere scoase');
    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
  });

  it.each([
    ['Mută mai jos', 1, ['s1', 's3', 's2']],
    ['Mută mai sus', 1, ['s2', 's1', 's3']],
  ] as const)('sends the whole order on %s', async (name, n, order) => {
    const { element, settle } = await render();

    menu(element, n)?.click();
    await settle();
    item(name)?.click();
    await settle();

    expect(api['jobStepsControllerReorder']).toHaveBeenCalledWith({
      body: { stepIds: order },
      id: 'job-1',
    });
    expect(rows(element).map((r) => r.getAttribute('data-step'))).toEqual(
      order,
    );
  });

  it('offers no move up on the first step and no move down on the last', async () => {
    const { element, settle } = await render();

    menu(element, 0)?.click();
    await settle();
    expect(item('Mută mai sus')).toBeUndefined();
    expect(item('Mută mai jos')).toBeDefined();
  });

  it('removes a step from its menu', async () => {
    const { element, settle } = await render();

    menu(element, 2)?.click();
    await settle();
    item('Șterge')?.click();
    await settle();

    expect(api['jobStepsControllerRemove']).toHaveBeenCalledWith({
      id: 'job-1',
      stepId: 's3',
    });
    expect(rows(element)).toHaveLength(2);
  });
});

// @traces 424-FR-015
describe('changes made by someone else', () => {
  it.each(['job.step_done', 'job.step_undone', 'job.steps_changed'] as const)(
    'reads the job again on %s about it, once for a burst',
    async (kind) => {
      const { settle } = await render();

      for (let i = 0; i < 3; i++)
        events.next({ at: '2026-10-09T07:00:00.000Z', id: 'job-1', kind });
      await wait(400);
      await settle();

      expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps what someone else changed when its own refused write is put back', async () => {
    const { element, settle } = await render();
    let refuse: ((error: unknown) => void) | undefined;
    api['jobStepsControllerRemove'].mockImplementation(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    menu(element, 2)?.click();
    await settle();
    item('Șterge')?.click();
    await settle();
    expect(rows(element)).toHaveLength(2);

    serve(job({ steps: [step(1), step(2), step(3), step(4)] }));
    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.steps_changed',
    });
    await wait(400);
    await settle();
    expect(rows(element)).toHaveLength(4);

    refuse?.(refused(409, 'job_closed', 'Lucrarea e închisă'));
    await wait(0);
    await settle();

    expect(rows(element)).toHaveLength(4);
  });

  it('reads the job again when a refused write has another one of its own on top', async () => {
    const { element, settle } = await render();
    let refuse: ((error: unknown) => void) | undefined;
    api['jobStepsControllerRename'].mockImplementation(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Etriere scoase');
    button(element, 'Salvează')?.click();
    await settle();
    menu(element, 2)?.click();
    await settle();
    item('Șterge')?.click();
    await settle();

    refuse?.(refused(409, 'job_closed', 'Lucrarea e închisă'));
    await wait(0);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
    expect(text(rows(element)[1])).toContain('Pas 2');
  });

  it('ignores the steps of another job', async () => {
    const { settle } = await render();

    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-2',
      kind: 'job.step_done',
    });
    await wait(400);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(1);
  });

  it('keeps a step being renamed in edit mode, with what was typed', async () => {
    const { element, settle } = await render();
    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Etriere scoa');

    serve(
      job({
        steps: [
          step(1),
          step(2),
          step(3, { doneAt: '2026-10-09T07:00:00.000Z' }),
        ],
      }),
    );
    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.step_done',
    });
    await wait(400);
    await settle();

    expect(input(element)?.value).toBe('Etriere scoa');
    expect(ticks(element)[2].getAttribute('aria-pressed')).toBe('true');
  });
});
