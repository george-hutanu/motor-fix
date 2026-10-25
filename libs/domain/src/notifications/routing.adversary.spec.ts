import type { OutsideChannel } from '@motor-fix/contracts';

import { mutedChannels, type PreferenceRow } from './preferences/preferences';
import { substitutions } from './routing';

const GARAGE = '6f1c2f4e-8a0b-4c55-9d52-0d9f6b1f3a11';
const reach = (over: Partial<Record<string, boolean>> = {}) => ({
  email: true,
  phone: true,
  push: true,
  whatsapp: true,
  ...over,
});
const chose = (type: string, channel: OutsideChannel, enabled = true) =>
  mutedChannels(type, [
    { channel, enabled, garageId: null, type },
  ] as PreferenceRow[]);

// @traces 142-FR-008
describe('the send-time substitutions of a driver type', () => {
  it('names a push with no device as no_device by e-mail', () => {
    expect(
      substitutions(
        'DUE_ITP',
        chose('DUE_ITP', 'push'),
        reach({ push: false }),
      ),
    ).toEqual([{ from: 'push', reason: 'no_device', to: 'email' }]);
  });

  it.each(['sms', 'whatsapp'] as const)(
    'names %s without a confirmed phone as phone_not_verified by e-mail',
    (channel) => {
      expect(
        substitutions(
          'DUE_ITP',
          chose('DUE_ITP', channel),
          reach({ phone: false }),
        ),
      ).toEqual([{ from: channel, reason: 'phone_not_verified', to: 'email' }]);
    },
  );

  it('gives nothing when the chosen channel can be used', () => {
    expect(substitutions('DUE_ITP', chose('DUE_ITP', 'push'), reach())).toEqual(
      [],
    );
    expect(substitutions('DUE_ITP', chose('DUE_ITP', 'sms'), reach())).toEqual(
      [],
    );
    expect(
      substitutions(
        'DUE_ITP',
        chose('DUE_ITP', 'email'),
        reach({ phone: false, push: false }),
      ),
    ).toEqual([]);
  });

  it('gives nothing when the driver has no e-mail to fall back on', () => {
    expect(
      substitutions(
        'DUE_ITP',
        chose('DUE_ITP', 'push'),
        reach({ email: false, push: false }),
      ),
    ).toEqual([]);
  });

  it('gives nothing when the type is switched off', () => {
    expect(
      substitutions(
        'DUE_ITP',
        chose('DUE_ITP', 'push', false),
        reach({ push: false }),
      ),
    ).toEqual([]);
  });

  it('gives nothing for a staff message even with nothing reachable', () => {
    const none = reach({ phone: false, push: false });
    expect(substitutions('QUOTE_RECEIVED', new Set(), none, GARAGE)).toEqual(
      [],
    );
  });

  it('gives nothing for NEWS, which only goes by e-mail', () => {
    expect(
      substitutions(
        'NEWS',
        mutedChannels('NEWS', [
          { channel: 'email', enabled: true, garageId: null, type: 'NEWS' },
        ]),
        reach({ phone: false, push: false }),
      ),
    ).toEqual([]);
  });

  it('names one substitution for an always-sent type chosen on push with no device', () => {
    expect(
      substitutions(
        'JOB_READY',
        chose('JOB_READY', 'push'),
        reach({ push: false }),
      ),
    ).toEqual([{ from: 'push', reason: 'no_device', to: 'email' }]);
  });

  it('gives nothing when nothing is muted but every channel is unreachable and only e-mail is open', () => {
    const muted = new Set<OutsideChannel>(['push', 'sms', 'whatsapp']);
    expect(
      substitutions('DUE_ITP', muted, reach({ phone: false, push: false })),
    ).toEqual([]);
  });

  it('throws for a type the catalogue does not know', () => {
    expect(() => substitutions('NOT_A_TYPE', new Set(), reach())).toThrow(
      'unknown notification type NOT_A_TYPE',
    );
  });

  it('gives the same answer when called twice', () => {
    const muted = chose('DUE_ITP', 'push');
    const r = reach({ push: false });
    expect(substitutions('DUE_ITP', muted, r)).toEqual(
      substitutions('DUE_ITP', muted, r),
    );
  });
});
