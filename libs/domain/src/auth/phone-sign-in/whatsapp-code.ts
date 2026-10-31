import { HttpStatus, type Logger } from '@nestjs/common';

import { CODE_TTL_MS } from './phone-sign-in';
import type { DirectSend } from '../../notifications/direct-send/direct-send.client';
import { refusal } from '../http-refusal';

// The approved WhatsApp templates that carry a six-digit code.
type CodeTemplate = 'SIGN_IN_CODE' | 'PHONE_CHANGE_CODE';

// Sends the code through the worker's direct-send, not the notifications
// queue: the person is waiting for it. A code that did not leave is refused 502
// `whatsapp_failed`; neither the number nor the code is logged.
export async function sendWhatsAppCode(
  sender: { directSend: DirectSend; logger: Logger },
  template: CodeTemplate,
  to: string,
  language: 'ro' | 'en',
  code: string,
): Promise<void> {
  const kind = await sender.directSend.whatsapp(
    template,
    language,
    { code, minutes: CODE_TTL_MS / 60_000 },
    to,
  );
  if (kind === null) return;
  sender.logger.error(`phone code not sent: whatsapp_failed (${kind})`);
  throw refusal(
    HttpStatus.BAD_GATEWAY,
    'whatsapp_failed',
    'The code could not be sent by WhatsApp',
  );
}
