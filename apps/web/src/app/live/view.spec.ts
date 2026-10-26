import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, Subject } from 'rxjs';

import { liveView } from './view';

// A read that answers when the test says so.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r));

function setup() {
  const answers: ReturnType<typeof deferred<number>>[] = [];
  const load = jest.fn(() => {
    const next = deferred<number>();
    answers.push(next);
    return next.promise;
  });
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector),
  );
  const view = runInInjectionContext(injector, () =>
    liveView(load, {
      changes: NEVER,
      goneOn: [404],
      resync: new Subject<void>(),
    }),
  );
  return { answers, injector, load, view };
}

// @traces 1255-FR-013
describe('a live view asked to read again', () => {
  it('resolves a reload asked during a read only after the read that follows it', async () => {
    const { answers, load, view } = setup();
    let done = false;
    const reload = view.reload().then(() => {
      done = true;
    });

    answers[0].resolve(1);
    await tick();
    expect(done).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);

    answers[1].resolve(2);
    await reload;
    expect(view.value()).toBe(2);
    expect(view.reads()).toBe(2);
  });

  it('starts a new read for a reload asked once the last read has ended', async () => {
    const { answers, load, view } = setup();
    answers[0].resolve(1);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);

    const reload = view.reload();
    expect(load).toHaveBeenCalledTimes(2);
    answers[1].resolve(2);
    await reload;

    expect(view.value()).toBe(2);
    expect(view.reads()).toBe(2);
  });

  it('resolves a waiting reload without another read when the view goes away mid-read', async () => {
    const { answers, injector, load, view } = setup();
    const reload = view.reload();

    injector.destroy();
    answers[0].resolve(1);
    await reload;

    expect(load).toHaveBeenCalledTimes(1);
    expect(view.value()).toBeUndefined();
    expect(view.reads()).toBe(0);
    await expect(view.reload()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
