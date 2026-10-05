import { type PushEnv, pushSupport } from './push-support';

const env = (change: Partial<PushEnv> = {}): PushEnv => ({
  hasPushManager: true,
  maxTouchPoints: 0,
  permission: () => 'default',
  standalone: false,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
  ...change,
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari';

describe('pushSupport', () => {
  it('supports a browser with push', () => {
    expect(pushSupport(env())).toBe('supported');
  });

  it('says unsupported for a browser without push', () => {
    expect(pushSupport(env({ hasPushManager: false }))).toBe('unsupported');
  });

  it.each([
    ['an iPhone', { userAgent: IPHONE }],
    [
      'an iPad asking for the desktop site',
      {
        maxTouchPoints: 5,
        userAgent: IPAD_AS_MAC,
      },
    ],
  ])(
    'gives the Home Screen hint on %s in a tab, with or without PushManager',
    (_n, change) => {
      expect(pushSupport(env(change))).toBe('ios-hint');
      expect(pushSupport(env({ ...change, hasPushManager: false }))).toBe(
        'ios-hint',
      );
    },
  );

  it('supports an iPhone app opened from the Home Screen', () => {
    expect(pushSupport(env({ standalone: true, userAgent: IPHONE }))).toBe(
      'supported',
    );
  });

  it('says unsupported for an installed app without push', () => {
    expect(
      pushSupport(
        env({ hasPushManager: false, standalone: true, userAgent: IPHONE }),
      ),
    ).toBe('unsupported');
  });

  it('does not take a Mac without a touch screen for an iPad', () => {
    expect(pushSupport(env({ userAgent: IPAD_AS_MAC }))).toBe('supported');
  });
});
