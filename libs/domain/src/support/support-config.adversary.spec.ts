import { Logger } from '@nestjs/common';

import { supportConfig } from './support-config';

// @traces 280-FR-011 280-FR-016 280-FR-017 280-FR-018
describe('the support settings under hostile input', () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    '',
    '   ',
    'help',
    'help@',
    '@example.test',
    'help@example',
    'a b@example.test',
    'a@b@example.test.',
    'help@example.test\nBcc: x@y.test',
  ])('leaves the address unset for %j and names SUPPORT_EMAIL', (value) => {
    expect(supportConfig({ SUPPORT_EMAIL: value })).toEqual({});
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('SUPPORT_EMAIL'),
    );
  });

  it('does not read the address from an unrelated key', () => {
    expect(supportConfig({ EMAIL_FROM: 'noreply@example.test' })).toEqual({});
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '03.11.2026',
    '2026-11-03T10:00',
    'soon',
    '0000-00-00',
  ])('marks the away date %j unreadable and logs it', (value) => {
    const config = supportConfig({
      SUPPORT_AWAY_UNTIL: value,
      SUPPORT_EMAIL: 'help@example.test',
    });
    expect(config).toEqual({
      awayUnreadable: true,
      email: 'help@example.test',
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('SUPPORT_AWAY_UNTIL'),
    );
  });

  it.each(['', '   '])(
    'reads a blank away date %j as unset without complaint',
    (value) => {
      expect(
        supportConfig({
          SUPPORT_AWAY_UNTIL: value,
          SUPPORT_EMAIL: 'help@example.test',
        }),
      ).toEqual({
        email: 'help@example.test',
      });
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('keeps an away date even when the address is missing', () => {
    expect(supportConfig({ SUPPORT_AWAY_UNTIL: '2026-11-03' })).toEqual({
      awayUntil: '2026-11-03',
    });
  });

  it('answers the same twice', () => {
    const source = {
      SUPPORT_AWAY_UNTIL: 'bad',
      SUPPORT_EMAIL: 'help@example.test',
    };
    expect(supportConfig(source)).toEqual(supportConfig(source));
  });
});
