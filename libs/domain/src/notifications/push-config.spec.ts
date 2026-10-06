import { generateVAPIDKeys } from 'web-push';

import { pushConfig } from './push-config';

const keys = generateVAPIDKeys();
const all = {
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_SUBJECT: 'mailto:ops@example.test',
};

describe('pushConfig', () => {
  it('is null when no key is set, blanks included', () => {
    expect(pushConfig({})).toBeNull();
    expect(
      pushConfig({
        VAPID_PRIVATE_KEY: ' ',
        VAPID_PUBLIC_KEY: '',
        VAPID_SUBJECT: undefined,
      }),
    ).toBeNull();
  });

  it('reads the three values', () => {
    expect(pushConfig(all)).toEqual({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      subject: 'mailto:ops@example.test',
    });
  });

  it.each(['VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT'])(
    'refuses to start without %s when the others are set',
    (missing) => {
      expect(() => pushConfig({ ...all, [missing]: undefined })).toThrow(
        /VAPID/,
      );
    },
  );

  it.each(['ops@example.test', 'http://example.test', 'tel:123'])(
    'refuses the subject %s',
    (subject) => {
      expect(() => pushConfig({ ...all, VAPID_SUBJECT: subject })).toThrow(
        /VAPID_SUBJECT/,
      );
    },
  );

  it('accepts an https subject', () => {
    expect(
      pushConfig({ ...all, VAPID_SUBJECT: 'https://example.test/contact' }),
    ).not.toBeNull();
  });
});
