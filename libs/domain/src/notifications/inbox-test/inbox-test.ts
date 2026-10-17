import type { Brevo } from '../brevo/brevo';
import {
  blockedReason,
  type EmailConfig,
  emailEnvelope,
} from '../email-config';
import { type Registry, render, TemplateError } from '../templates';
import { TEMPLATES } from '../templates/registry';

// The examples' links all start here; the test mails open the real app.
const EXAMPLE_APP = 'https://motorfix.example';
const LANGUAGES = ['ro', 'en'] as const;

interface InboxRow {
  template: string;
  language: (typeof LANGUAGES)[number];
  to: string;
  params: Record<string, unknown>;
  mail?: { subject: string; text: string; html: string };
  error?: string;
}

export function inboxMailboxes(value = ''): string[] {
  const all = value.split(',').map((entry) => entry.trim().toLowerCase());
  return [...new Set(all.filter(Boolean))];
}

// The example values, their links moved onto the web app, plus the app.
function exampleParams(
  example: Readonly<Record<string, unknown>>,
  webUrl: string | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = { app: webUrl };
  for (const [key, value] of Object.entries(example)) {
    params[key] =
      webUrl && typeof value === 'string' && value.startsWith(EXAMPLE_APP)
        ? webUrl + value.slice(EXAMPLE_APP.length)
        : value;
  }
  return params;
}

function written(
  template: string,
  language: InboxRow['language'],
  params: Record<string, unknown>,
  registry: Registry,
): Pick<InboxRow, 'mail' | 'error'> {
  try {
    return { mail: render(template, 'email', language, params, registry) };
  } catch (failure) {
    if (!(failure instanceof TemplateError)) throw failure;
    return { error: failure.reason };
  }
}

// Every template with an e-mail, in both languages, to every mailbox, each
// written from its example values as the queue would write it.
function inboxMatrix(
  mailboxes: readonly string[],
  webUrl: string | undefined,
  registry: Registry = TEMPLATES,
): InboxRow[] {
  return Object.entries(registry)
    .filter(([, { email }]) => email)
    .flatMap(([template, { example }]) => {
      const params = exampleParams(example, webUrl);
      return LANGUAGES.flatMap((language) => {
        const mail = written(template, language, params, registry);
        return mailboxes.map((to) => ({
          ...mail,
          language,
          params,
          template,
          to,
        }));
      });
    });
}

// Why a real run may not send at all; null when it may.
function refusal(config: EmailConfig, mailboxes: readonly string[]) {
  if (!config.sending) return 'sending_off: EMAIL_SENDING is not on';
  if (!config.apiKey) return 'BREVO_API_KEY is not set';
  if (!config.domain) return 'EMAIL_DOMAIN is not set';
  if (mailboxes.length === 0) return 'INBOX_TEST_TO is not set';
  for (const to of mailboxes) {
    const reason = blockedReason(config, to);
    if (reason) return `${reason} ${to}`;
  }
  return null;
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Answers the exit code: 1 when anything failed or the run was refused.
export async function runInboxTest(options: {
  config: EmailConfig;
  mailboxes: readonly string[];
  dryRun: boolean;
  send: Brevo['send'];
  print: (line: string) => void;
  registry?: Registry;
}): Promise<number> {
  const { config, mailboxes, dryRun, print } = options;
  const refused = dryRun ? null : refusal(config, mailboxes);
  if (refused) {
    print(`refused: ${refused}`);
    return 1;
  }
  let failed = false;
  for (const row of inboxMatrix(mailboxes, config.webUrl, options.registry)) {
    const at = `${row.template} ${row.language} ${row.to}`;
    if (!row.mail) {
      failed = true;
      print(`${at} FAILED ${row.error}`);
      continue;
    }
    if (dryRun) {
      print(`${at} ${row.mail.subject}`);
      continue;
    }
    try {
      const id = await options.send({
        ...emailEnvelope(config, { email: row.to }, row.params),
        html: row.mail.html,
        subject: row.mail.subject,
        text: row.mail.text,
      });
      print(`${at} ${row.mail.subject} sent ${id}`);
    } catch (error) {
      failed = true;
      print(`${at} ${row.mail.subject} FAILED ${reason(error)}`);
    }
  }
  return failed ? 1 : 0;
}
