import { Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import { initializeFaro } from '@grafana/faro-web-sdk';

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

const router = { navigated: true } as Router;
const injector = Injector.create({
  providers: [{ provide: Router, useValue: router }, consent],
});

function pageWith(meta: string): Document {
  const doc = document.implementation.createHTMLDocument('MotorFix');
  doc.head.innerHTML = meta;
  return doc;
}

beforeEach(() => vi.mocked(initializeFaro).mockReset());

describe('loadTelemetry with hostile pages', () => {
  it('loads nothing when the tag has an empty content', async () => {
    await loadTelemetry(
      injector,
      pageWith('<meta name="mf-telemetry" content="" data-version="x">'),
    );
    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it('loads nothing when the tag has no content attribute', async () => {
    await loadTelemetry(injector, pageWith('<meta name="mf-telemetry">'));
    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it('does not start with a javascript: collector url', async () => {
    await loadTelemetry(
      injector,
      pageWith(
        '<meta name="mf-telemetry" content="javascript:alert(1)" data-version="x">',
      ),
    );
    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it('swallows a failure thrown by startup', async () => {
    vi.mocked(initializeFaro).mockImplementation(() => {
      throw new Error('start failed');
    });
    await expect(
      loadTelemetry(
        injector,
        pageWith(
          '<meta name="mf-telemetry" content="https://f.example/c/k" data-version="x">',
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it('starts once when the page carries two tags', async () => {
    await loadTelemetry(
      injector,
      pageWith(
        '<meta name="mf-telemetry" content="https://f.example/a" data-version="x"><meta name="mf-telemetry" content="https://evil.example/b" data-version="y">',
      ),
    );
    expect(initializeFaro).toHaveBeenCalledTimes(1);
    expect(initializeFaro).toHaveBeenCalledWith(
      expect.objectContaining({
        app: { environment: 'development', name: 'web', version: 'x' },
        url: 'https://f.example/a',
      }),
    );
  });
});
