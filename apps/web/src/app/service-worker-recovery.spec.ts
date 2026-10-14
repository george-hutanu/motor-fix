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
  reason: 'hash mismatch',
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

// @traces 1201-FR-005
describe('service worker recovery', () => {
  it('reloads the page once for each unrecoverable report', () => {
    const { unrecoverable, reload } = start(true);
    expect(reload).not.toHaveBeenCalled();
    unrecoverable.next(broken);
    expect(reload).toHaveBeenCalledTimes(1);
    unrecoverable.next(broken);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not listen when the service worker is off', () => {
    const { unrecoverable, reload } = start(false);
    expect(unrecoverable.observed).toBe(false);
    unrecoverable.next(broken);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops listening once the injector is destroyed', () => {
    const { unrecoverable, reload } = start(true);
    TestBed.resetTestingModule();
    unrecoverable.next(broken);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the reports end without one', () => {
    const { unrecoverable, reload } = start(true);
    unrecoverable.complete();
    expect(reload).not.toHaveBeenCalled();
  });
});
