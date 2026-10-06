import { NEWS_CONSENT_TEXT_VERSION } from './notification-preferences.dto';

describe('NEWS_CONSENT_TEXT_VERSION', () => {
  it('names the consent text by its calendar day', () => {
    expect(NEWS_CONSENT_TEXT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
