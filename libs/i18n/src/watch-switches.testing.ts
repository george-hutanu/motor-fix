import type { MockInstance } from 'vitest';

import { I18n } from './i18n';

/**
 * A switch waits for its texts, loaded by a real import() that can take longer
 * than a tick. Watches every `I18n.use` of a test (call it at the top of a spec
 * file); the function returned waits until every switch so far has finished.
 */
export function watchSwitches(): () => Promise<void> {
  let use: MockInstance<I18n['use']>;
  beforeEach(() => {
    use = vi.spyOn(I18n.prototype, 'use');
  });
  return async () => {
    await Promise.all(use.mock.results.map((result) => result.value));
    await new Promise((resolve) => setTimeout(resolve));
  };
}
