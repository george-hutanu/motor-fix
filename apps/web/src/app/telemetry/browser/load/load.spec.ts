import type { Router } from '@angular/router';

import { loadTelemetry } from './load';
import { startFaro } from '../faro';

jest.mock('../faro', () => ({ startFaro: jest.fn() }));

const router = {} as Router;

function pageWith(meta?: string): Document {
  const doc = document.implementation.createHTMLDocument('MotorFix');
  if (meta) doc.head.innerHTML = meta;
  return doc;
}

beforeEach(() => jest.mocked(startFaro).mockReset());

describe('loadTelemetry', () => {
  it('loads nothing when the page carries no telemetry tag', async () => {
    await loadTelemetry(router, pageWith());

    expect(startFaro).not.toHaveBeenCalled();
  });

  it('starts telemetry with the collector and release from the tag', async () => {
    await loadTelemetry(
      router,
      pageWith(
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234" data-environment="staging">',
      ),
    );

    expect(startFaro).toHaveBeenCalledTimes(1);
    expect(startFaro).toHaveBeenCalledWith({
      environment: 'staging',
      router,
      url: 'https://faro.example/collect/key',
      version: 'abc1234',
    });
  });

  // @traces 879-FR-002
  it('falls back to development when the tag names no environment', async () => {
    await loadTelemetry(
      router,
      pageWith(
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
      ),
    );

    expect(startFaro).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'development' }),
    );
  });

  it('waits until the page is idle before loading', async () => {
    const idle = jest.fn();
    Object.assign(window, { requestIdleCallback: idle });
    try {
      void loadTelemetry(
        router,
        pageWith(
          '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
        ),
      );
      await Promise.resolve();

      expect(idle).toHaveBeenCalledTimes(1);
      expect(startFaro).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, 'requestIdleCallback');
    }
  });

  it('swallows a failure to start, leaving the page alone', async () => {
    jest.mocked(startFaro).mockImplementation(() => {
      throw new Error('blocked by an extension');
    });
    const errors = jest.spyOn(console, 'error').mockImplementation();

    await expect(
      loadTelemetry(
        router,
        pageWith(
          '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
        ),
      ),
    ).resolves.toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
