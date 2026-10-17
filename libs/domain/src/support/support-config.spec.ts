import { Logger } from '@nestjs/common';

import { supportConfig } from './support-config';

// @traces 280-FR-011 280-FR-016 280-FR-017 280-FR-018
describe('the support settings', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const NOW = new Date('2026-10-17T09:00:00Z');

  it('reads the address and the away date, trimmed', () => {
    expect(
      supportConfig(
        {
          SUPPORT_AWAY_UNTIL: ' 2026-11-03 ',
          SUPPORT_EMAIL: ' help@example.test ',
        },
        NOW,
      ),
    ).toEqual({ awayUntil: '2026-11-03', email: 'help@example.test' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves both unset when absent, naming SUPPORT_EMAIL in a warning', () => {
    expect(supportConfig({})).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SUPPORT_EMAIL'));
  });

  it.each(['', '   ', 'help', 'help@', 'a b@example.test'])(
    'reads SUPPORT_EMAIL=%p as unset',
    (value) => {
      expect(supportConfig({ SUPPORT_EMAIL: value }).email).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('SUPPORT_EMAIL'),
      );
    },
  );

  it.each(['soon', '2026-13-01', '2026-02-30', '03.11.2026'])(
    'reads SUPPORT_AWAY_UNTIL=%p as unset and says so',
    (value) => {
      expect(
        supportConfig({
          SUPPORT_AWAY_UNTIL: value,
          SUPPORT_EMAIL: 'help@example.test',
        }),
      ).toEqual({ awayUnreadable: true, email: 'help@example.test' });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('SUPPORT_AWAY_UNTIL'),
      );
    },
  );

  it.each(['2026-10-17', '2026-01-01'])(
    'logs an away date of %p, not after today, at start',
    (value) => {
      supportConfig(
        { SUPPORT_AWAY_UNTIL: value, SUPPORT_EMAIL: 'help@example.test' },
        NOW,
      );
      expect(warn).toHaveBeenCalledWith(
        `SUPPORT_AWAY_UNTIL ${value} is not after today: read as unset`,
      );
    },
  );

  // @traces 279-email-inbox-FR-003
  it('falls back to support at the sending domain, without a warning', () => {
    expect(supportConfig({ EMAIL_DOMAIN: 'Example.test' }, NOW)).toEqual({
      email: 'support@example.test',
    });
    expect(
      supportConfig(
        { EMAIL_DOMAIN: 'example.test', SUPPORT_EMAIL: 'help@other.test' },
        NOW,
      ).email,
    ).toBe('help@other.test');
    expect(warn).not.toHaveBeenCalled();
  });
});
