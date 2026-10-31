import { Injector, signal } from '@angular/core';
import {
  type Event,
  NavigationEnd,
  NavigationStart,
  Router,
} from '@angular/router';
import { initializeFaro } from '@grafana/faro-web-sdk';
import { Subject } from 'rxjs';

import { loadTelemetry } from './load';
import { Consent } from '../../../consent/consent';

// The builder bundles '../faro' into the spec, so the SDK it starts is mocked
// instead: initializeFaro stands for startFaro reaching the collector.
vi.mock('@grafana/faro-web-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  faro: {
    api: { pushEvent: vi.fn(), pushMeasurement: vi.fn(), setSession: vi.fn() },
  },
  initializeFaro: vi.fn(),
}));
vi.mock('@grafana/faro-web-tracing', () => ({
  TracingInstrumentation: vi.fn(),
}));

const consent = { provide: Consent, useValue: { granted: signal(false) } };

// A page whose first navigation has finished.
const router = { navigated: true } as Router;
const injectorOf = (value: Router) =>
  Injector.create({
    providers: [{ provide: Router, useValue: value }, consent],
  });
const injector = injectorOf(router);

function pageWith(meta?: string): Document {
  const doc = document.implementation.createHTMLDocument('MotorFix');
  if (meta) doc.head.innerHTML = meta;
  return doc;
}

beforeEach(() => vi.mocked(initializeFaro).mockReset());

describe('loadTelemetry', () => {
  it('loads nothing when the page carries no telemetry tag', async () => {
    await loadTelemetry(injector, pageWith());

    expect(initializeFaro).not.toHaveBeenCalled();
  });

  // @traces 947-FR-012
  it('starts telemetry with the collector and release from the tag', async () => {
    await loadTelemetry(
      injector,
      pageWith(
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234" data-environment="staging">',
      ),
    );

    expect(initializeFaro).toHaveBeenCalledTimes(1);
    expect(initializeFaro).toHaveBeenCalledWith(
      expect.objectContaining({
        app: { environment: 'staging', name: 'web', version: 'abc1234' },
        url: 'https://faro.example/collect/key',
      }),
    );
  });

  // @traces 879-FR-002
  it('falls back to development when the tag names no environment', async () => {
    await loadTelemetry(
      injector,
      pageWith(
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
      ),
    );

    expect(initializeFaro).toHaveBeenCalledWith(
      expect.objectContaining({
        app: expect.objectContaining({ environment: 'development' }),
      }),
    );
  });

  it('waits until the page is idle before loading', async () => {
    const idle = vi.fn();
    Object.assign(window, { requestIdleCallback: idle });
    try {
      void loadTelemetry(
        injector,
        pageWith(
          '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
        ),
      );
      await Promise.resolve();

      expect(idle).toHaveBeenCalledTimes(1);
      expect(initializeFaro).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, 'requestIdleCallback');
    }
  });

  it('starts only once the first navigation has finished, so the page is named by its route', async () => {
    const events = new Subject<Event>();
    const loading = { events, navigated: false } as unknown as Router;

    const done = loadTelemetry(
      injectorOf(loading),
      pageWith(
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
      ),
    );
    events.next(new NavigationStart(1, '/ro'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(initializeFaro).not.toHaveBeenCalled();

    events.next(new NavigationEnd(1, '/ro', '/ro'));
    await done;
    expect(initializeFaro).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure to start, leaving the page alone', async () => {
    vi.mocked(initializeFaro).mockImplementation(() => {
      throw new Error('blocked by an extension');
    });
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      loadTelemetry(
        injector,
        pageWith(
          '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
        ),
      ),
    ).resolves.toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
