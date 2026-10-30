import type { Job } from 'bullmq';

import { type Brevo, BrevoError } from '../brevo/brevo';
import {
  blockedReason,
  type EmailConfig,
  emailEnvelope,
} from '../email-config';
import { type PhoneConfig, phoneBlockedReason } from '../phone-config';
import { render } from '../templates';

// The messages a person waits for (a sign-in or phone change code, a staff
// invite, a car transfer link): the API adds one job and waits for its answer,
// the worker sends it. One attempt, never retried.
export const DIRECT_SEND_QUEUE = 'direct-send';

// How long the API waits for the worker's answer; a job picked up later than
// this is not sent, since its caller has already been told it failed. The
// job's age is read on the worker's clock against the API's: both hosts'
// clocks are assumed to agree well within the cap.
export const DIRECT_SEND_WAIT_MS = 8000;

// The job's name is its channel: 'whatsapp' or 'email'. The values and the
// recipient are never logged.
export interface DirectSendJob {
  template: string;
  language: 'ro' | 'en';
  values: Record<string, unknown>;
  to: string;
  // E-mail only: the recipient's name on the envelope.
  name?: string;
}

interface DirectSender {
  brevo: Pick<Brevo, 'send' | 'sendWhatsApp'>;
  email: EmailConfig;
  phone: PhoneConfig;
}

// Why the provider did not take it; the job fails with only this.
function providerFailure(error: unknown): Error {
  return new Error(
    error instanceof BrevoError ? error.reason : 'provider_error',
  );
}

async function whatsapp(
  { brevo, phone }: DirectSender,
  { language, template, to, values }: DirectSendJob,
): Promise<string | null> {
  const blocked = phoneBlockedReason(phone, to);
  if (blocked) return blocked;
  const message = render(template, 'whatsapp', language, values);
  const templateId = Object.hasOwn(phone.whatsappTemplates, message.name)
    ? phone.whatsappTemplates[message.name]
    : undefined;
  if (templateId === undefined) return 'template_missing';
  try {
    await brevo.sendWhatsApp({
      params: message.params,
      sender: phone.whatsappSender,
      templateId,
      to,
    });
  } catch (error) {
    throw providerFailure(error);
  }
  return null;
}

async function email(
  { brevo, email: config }: DirectSender,
  { language, name, template, to, values }: DirectSendJob,
): Promise<string | null> {
  const blocked = blockedReason(config, to);
  if (blocked) return blocked;
  const mail = render(template, 'email', language, values);
  try {
    await brevo.send({
      ...emailEnvelope(config, { email: to, name }),
      html: mail.html,
      subject: mail.subject,
      text: mail.text,
    });
  } catch (error) {
    throw providerFailure(error);
  }
  return null;
}

// Answers null when the message left, otherwise why it did not; a provider
// refusal or timeout fails the job with its reason instead.
export async function sendDirect(
  sender: DirectSender,
  job: Job<DirectSendJob>,
): Promise<string | null> {
  // Written so a job with no readable age is stale too.
  if (!(Date.now() - job.timestamp <= DIRECT_SEND_WAIT_MS)) return 'stale';
  if (job.name === 'email') return email(sender, job.data);
  if (job.name === 'whatsapp') return whatsapp(sender, job.data);
  throw new Error('unknown_channel');
}
