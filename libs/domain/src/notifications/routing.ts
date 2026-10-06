import type { OutsideChannel } from '@motor-fix/contracts';

import {
  type NotificationType,
  notificationType,
  sendsEmail,
} from './catalogue';
import { isDriverChoice } from './preferences';

export type SentChannel = 'email' | 'push' | 'sms' | 'whatsapp';

// What the recipient can be reached by: an e-mail address, a verified phone,
// a push device (always false while push is not set up), and whether the
// message's garage lets its staff get WhatsApp.
interface Reach {
  email: boolean;
  phone: boolean;
  push: boolean;
  whatsapp: boolean;
}

function sentBy(
  channel: OutsideChannel,
  type: NotificationType,
  muted: ReadonlySet<OutsideChannel>,
  reach: Reach,
  driver: boolean,
): SentChannel | null {
  if (channel === 'push') return pushBy(type, muted, reach, driver);
  if (channel === 'email') return sendsEmail(type, muted) ? 'email' : null;
  if (muted.has(channel)) return null;
  if (reach.phone && (channel === 'sms' || reach.whatsapp)) return channel;
  return type.channels.includes('email') ? 'email' : null;
}

// Choosing push is what muted a driver's e-mail, so with no device the
// e-mail goes anyway; a staff choice leaves that to its own e-mail entry.
function pushBy(
  type: NotificationType,
  muted: ReadonlySet<OutsideChannel>,
  reach: Reach,
  driver: boolean,
): SentChannel | null {
  if (muted.has('push')) return null;
  if (reach.push) return 'push';
  return driver && type.channels.includes('email') ? 'email' : null;
}

// The outside rows a message writes. An SMS or WhatsApp the person cannot
// get goes by e-mail when the type allows it, and so does a push without a
// device. `garageId` is the garage whose staff choices the message goes by.
export function outsideChannels(
  name: string,
  muted: ReadonlySet<OutsideChannel>,
  reach: Reach,
  garageId: string | null = null,
): SentChannel[] {
  const type = notificationType(name);
  const driver = isDriverChoice(name, garageId);
  const sent = type.channels
    .map((channel) => sentBy(channel, type, muted, reach, driver))
    .filter(
      (c): c is SentChannel => c !== null && (c !== 'email' || reach.email),
    );
  return [...new Set(sent)].sort();
}
