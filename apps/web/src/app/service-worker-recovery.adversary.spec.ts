import { DOCUMENT } from '@angular/common';
import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SwUpdate,
  type UnrecoverableStateEvent,
} from '@angular/service-worker';
import { Subject } from 'rxjs';

import { provideServiceWorkerRecovery } from './service-worker-recovery';

const broken: UnrecoverableStateEvent = {
  reason: 'x',
  type: 'UNRECOVERABLE_STATE',
};

function start(isEnabled: boolean) {
  const unrecoverable = new Subject<UnrecoverableStateEvent>();
  const reload = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: SwUpdate, useValue: { isEnabled, unrecoverable } },
      { provide: DOCUMENT, useValue: { location: { reload } } },
      provideServiceWorkerRecovery(),
    ],
  });
  TestBed.inject(EnvironmentInjector);
  return { reload, unrecoverable };
}

describe('service worker recovery under odd streams', () => {
  it('reloads for every one of a burst of reports', () => {
    const { unrecoverable, reload } = start(true);
    for (let i = 0; i < 50; i++) unrecoverable.next(broken);
    expect(reload).toHaveBeenCalledTimes(50);
  });

  it('stops listening once the injector is destroyed', () => {
    const { unrecoverable, reload } = start(true);
    TestBed.resetTestingModule();
    unrecoverable.next(broken);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps reloading after a report when the stream completes later', () => {
    const { unrecoverable, reload } = start(true);
    unrecoverable.next(broken);
    unrecoverable.complete();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on completion alone', () => {
    const { unrecoverable, reload } = start(true);
    unrecoverable.complete();
    expect(reload).not.toHaveBeenCalled();
  });

  it('never subscribes when disabled, even after the stream completes', () => {
    const { unrecoverable, reload } = start(false);
    unrecoverable.next(broken);
    unrecoverable.complete();
    expect(unrecoverable.observed).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
