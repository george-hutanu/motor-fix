import { HttpStatus, type Logger } from '@nestjs/common';

import { CODE_TTL_MS } from './phone-sign-in';
import { type Brevo, BrevoError } from '../../notifications/brevo/brevo';
import {
  type PhoneConfig,
  phoneBlockedReason,
} from '../../notifications/phone-config';
import { render } from '../../notifications/templates';
import { refusal } from '../sign-up.service';

// The approved WhatsApp templates that carry a six-digit code.
export type CodeTemplate = 'SIGN_IN_CODE' | 'PHONE_CHANGE_CODE';

// Why a code was not sent, for the log: never the number.
function failureKind(error: unknown): string {
  return error instanceof BrevoError ? error.reason : 'provider_error';
}

// Sends the code straight through Brevo, not the notifications queue: the
// person is waiting for it. A code that did not leave is refused 502
// `whatsapp_failed`; neither the number nor the code is logged.
export async function sendWhatsAppCode(
  sender: { brevo: Brevo; config: PhoneConfig; logger: Logger },
  template: CodeTemplate,
  to: string,
  language: 'ro' | 'en',
  code: string,
): Promise<void> {
  const { brevo, config, logger } = sender;
  const message = render(template, 'whatsapp', language, {
    code,
    minutes: CODE_TTL_MS / 60_000,
  });
  const templateId = Object.hasOwn(config.whatsappTemplates, message.name)
    ? config.whatsappTemplates[message.name]
    : undefined;
  const kind =
    phoneBlockedReason(config, to) ??
    (templateId === undefined
      ? 'template_missing'
      : await brevo
          .sendWhatsApp({
            params: message.params,
            sender: config.whatsappSender,
            templateId,
            to,
          })
          .then(() => null, failureKind));
  if (kind === null) return;
  logger.error(`phone code not sent: whatsapp_failed (${kind})`);
  throw refusal(
    HttpStatus.BAD_GATEWAY,
    'whatsapp_failed',
    'The code could not be sent by WhatsApp',
  );
}
