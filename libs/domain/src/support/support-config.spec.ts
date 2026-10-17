import { Logger } from '@nestjs/common';

import { supportConfig } from './support-config';

// @traces 280-FR-011 280-FR-016 280-FR-017 280-FR-018
describe('the support settings', () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the address and the away date, trimmed', () => {
    expect(
      supportConfig({
        SUPPORT_AWAY_UNTIL: ' 2026-11-03 ',
        SUPPORT_EMAIL: ' help@example.test ',
      }),
    ).toEqual({ awayUntil: '2026-11-03', email: 'help@example.test' });
    expect(error).not.toHaveBeenCalled();
  });

  it('leaves both unset when absent, naming SUPPORT_EMAIL in an error', () => {
    expect(supportConfig({})).toEqual({});
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('SUPPORT_EMAIL'),
    );
  });

  it.each(['', '   ', 'help', 'help@', 'a b@example.test'])(
    'reads SUPPORT_EMAIL=%p as unset',
    (value) => {
      expect(supportConfig({ SUPPORT_EMAIL: value }).email).toBeUndefined();
      expect(error).toHaveBeenCalledWith(
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
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('SUPPORT_AWAY_UNTIL'),
      );
    },
  );
});
