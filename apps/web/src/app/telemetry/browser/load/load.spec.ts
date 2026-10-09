import {
  type Event,
  NavigationEnd,
  NavigationStart,
  type Router,
} from '@angular/router';
import { Subject } from 'rxjs';

import { loadTelemetry } from './load';
import { startFaro } from '../faro';

jest.mock('../faro', () => ({ startFaro: jest.fn() }));

// A page whose first navigation has finished.
const router = { navigated: true } as Router;

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
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
      ),
    );

    expect(startFaro).toHaveBeenCalledTimes(1);
    expect(startFaro).toHaveBeenCalledWith({
      router,
      url: 'https://faro.example/collect/key',
      version: 'abc1234',
    });
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

  it('starts only once the first navigation has finished, so the page is named by its route', async () => {
    const events = new Subject<Event>();
    const loading = { events, navigated: false } as unknown as Router;

    const done = loadTelemetry(
      loading,
      pageWith(
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">',
      ),
    );
    events.next(new NavigationStart(1, '/ro'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(startFaro).not.toHaveBeenCalled();

    events.next(new NavigationEnd(1, '/ro', '/ro'));
    await done;
    expect(startFaro).toHaveBeenCalledTimes(1);
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
