import type { Router } from '@angular/router';

import { loadTelemetry } from './load';
import { startFaro } from '../faro';

jest.mock('../faro', () => ({ startFaro: jest.fn() }));

const router = {} as Router;

function pageWith(meta: string): Document {
  const doc = document.implementation.createHTMLDocument('MotorFix');
  doc.head.innerHTML = meta;
  return doc;
}

beforeEach(() => jest.mocked(startFaro).mockReset());

describe('loadTelemetry with hostile pages', () => {
  it('loads nothing when the tag has an empty content', async () => {
    await loadTelemetry(
      router,
      pageWith('<meta name="mf-telemetry" content="" data-version="x">'),
    );
    expect(startFaro).not.toHaveBeenCalled();
  });

  it('loads nothing when the tag has no content attribute', async () => {
    await loadTelemetry(router, pageWith('<meta name="mf-telemetry">'));
    expect(startFaro).not.toHaveBeenCalled();
  });

  it('does not start with a javascript: collector url', async () => {
    await loadTelemetry(
      router,
      pageWith(
        '<meta name="mf-telemetry" content="javascript:alert(1)" data-version="x">',
      ),
    );
    expect(startFaro).not.toHaveBeenCalled();
  });

  it('swallows a failure thrown by startup', async () => {
    jest.mocked(startFaro).mockImplementation(() => {
      throw new Error('start failed');
    });
    await expect(
      loadTelemetry(
        router,
        pageWith(
          '<meta name="mf-telemetry" content="https://f.example/c/k" data-version="x">',
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it('starts once when the page carries two tags', async () => {
    await loadTelemetry(
      router,
      pageWith(
        '<meta name="mf-telemetry" content="https://f.example/a" data-version="x"><meta name="mf-telemetry" content="https://evil.example/b" data-version="y">',
      ),
    );
    expect(startFaro).toHaveBeenCalledTimes(1);
    expect(startFaro).toHaveBeenCalledWith({
      environment: 'development',
      router,
      url: 'https://f.example/a',
      version: 'x',
    });
  });
});
