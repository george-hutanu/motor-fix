export const PUSH_CONFIG = Symbol('PUSH_CONFIG');

// The server's VAPID identity for Web Push; without it push is off.
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const KEYS = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
] as const;

export function pushConfig(
  source: Readonly<Record<string, string | undefined>>,
): PushConfig | null {
  const [publicKey, privateKey, subject] = KEYS.map(
    (key) => source[key]?.trim() ?? '',
  );
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(`${KEYS.join(', ')} must all be set, or none`);
  }
  if (!/^(mailto:|https:\/\/)\S+$/.test(subject)) {
    throw new Error('VAPID_SUBJECT must be a mailto: or https: address');
  }
  return { privateKey, publicKey, subject };
}
