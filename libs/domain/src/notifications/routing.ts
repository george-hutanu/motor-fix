import type { OutsideChannel } from '@motor-fix/contracts';

import {
  type NotificationType,
  notificationType,
  sendsEmail,
} from './catalogue';

export type SentChannel = 'email' | 'sms' | 'whatsapp';

// What the recipient can be reached by: an e-mail address, a verified phone,
// and whether the message's garage lets its staff get WhatsApp.
interface Reach {
  email: boolean;
  phone: boolean;
  whatsapp: boolean;
}

function sentBy(
  channel: OutsideChannel,
  type: NotificationType,
  muted: ReadonlySet<OutsideChannel>,
  reach: Reach,
): SentChannel | null {
  if (channel === 'push') return null;
  if (channel === 'email') return sendsEmail(type, muted) ? 'email' : null;
  if (muted.has(channel)) return null;
  if (reach.phone && (channel === 'sms' || reach.whatsapp)) return channel;
  return type.channels.includes('email') ? 'email' : null;
}

// The outside rows a message writes. An SMS or WhatsApp the person cannot
// get goes by e-mail when the type allows it; push has no sender yet.
export function outsideChannels(
  name: string,
  muted: ReadonlySet<OutsideChannel>,
  reach: Reach,
): SentChannel[] {
  const type = notificationType(name);
  const sent = type.channels
    .map((channel) => sentBy(channel, type, muted, reach))
    .filter(
      (c): c is SentChannel => c !== null && (c !== 'email' || reach.email),
    );
  return [...new Set(sent)].sort();
}
