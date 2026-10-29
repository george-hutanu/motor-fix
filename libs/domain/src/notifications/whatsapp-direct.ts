import { type Brevo, BrevoError } from './brevo/brevo';
import { type PhoneConfig, phoneBlockedReason } from './phone-config';
import { render } from './templates';

// Why a message did not leave, for the log: never the number.
function failureKind(error: unknown): string {
  return error instanceof BrevoError ? error.reason : 'provider_error';
}

// Sends an approved WhatsApp template straight through Brevo, not the
// notifications queue, for a person waiting on the answer. Answers null when
// the message left, otherwise why it did not.
export async function sendWhatsAppDirect(
  sender: { brevo: Brevo; config: PhoneConfig },
  template: string,
  language: 'ro' | 'en',
  values: Record<string, unknown>,
  to: string,
): Promise<string | null> {
  const { brevo, config } = sender;
  const message = render(template, 'whatsapp', language, values);
  const templateId = Object.hasOwn(config.whatsappTemplates, message.name)
    ? config.whatsappTemplates[message.name]
    : undefined;
  return (
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
          .then(() => null, failureKind))
  );
}
