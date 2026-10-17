import { Resolver } from 'node:dns/promises';

import { readEnv } from '@motor-fix/contracts';
import {
  Brevo,
  checkEmailDns,
  type DnsResolver,
  dnsReport,
  emailConfig,
  inboxMailboxes,
  runInboxTest,
  sendingDomain,
} from '@motor-fix/domain';

type Env = Record<string, string | undefined>;
type Print = (line: string) => void;

interface Deps {
  resolver: DnsResolver;
  send: Brevo['send'];
  print: Print;
}

async function dnsCheck(env: Env, deps: Partial<Deps>, print: Print) {
  const domain = sendingDomain(env);
  if (!domain) {
    print('EMAIL_DOMAIN is not set');
    return 1;
  }
  const report = dnsReport(
    await checkEmailDns(domain, deps.resolver ?? new Resolver()),
  );
  for (const line of report.lines) print(line);
  return report.ok ? 0 : 1;
}

function inboxTest(
  dryRun: boolean,
  env: Env,
  deps: Partial<Deps>,
  print: Print,
) {
  let config: ReturnType<typeof emailConfig>;
  try {
    config = emailConfig(readEnv([], env).APP_ENV, env);
  } catch (error) {
    print((error as Error).message);
    return Promise.resolve(1);
  }
  const brevo = new Brevo({
    apiKey: config.apiKey ?? '',
    apiUrl: config.apiUrl,
  });
  return runInboxTest({
    config,
    dryRun,
    mailboxes: inboxMailboxes(env['INBOX_TEST_TO']),
    print,
    send: deps.send ?? ((mail) => brevo.send(mail)),
  });
}

// The owner's checks of the sending domain, run from the built worker
// without its queues or listener. Answers the exit code, or null to boot.
export function runCommand(
  argv: readonly string[],
  env: Env,
  deps: Partial<Deps> = {},
): Promise<number | null> {
  const [command, ...flags] = argv;
  const print = deps.print ?? ((line: string) => console.log(line));
  if (command === 'email-dns-check') return dnsCheck(env, deps, print);
  if (command === 'inbox-test') {
    return inboxTest(flags.includes('--dry-run'), env, deps, print);
  }
  return Promise.resolve(null);
}
