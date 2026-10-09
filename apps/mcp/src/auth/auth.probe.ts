import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { ISSUER_SETTINGS, type IssuerSettings } from './auth.verifier';
import { setIssuerUp } from '../metrics/metrics';

// Fixed rather than configurable: the alerts' 5-minute windows and the
// dashboard assume a sample a minute, each probe settled within 10 s.
const EVERY_MS = 60_000;
const TIMEOUT_MS = 10_000;

// Asks the identity server for its realm's discovery document once a minute,
// so the dashboard and the alert see it go down even while no assistant
// calls. Only the status is read; the answer's body never is.
@Injectable()
export class IssuerProbe implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IssuerProbe');
  private timer?: NodeJS.Timeout;
  private last?: boolean;

  constructor(
    @Inject(ISSUER_SETTINGS) private readonly settings: IssuerSettings,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.probe(), EVERY_MS);
    this.timer.unref();
    // Not awaited: a hanging identity server must not hold the boot.
    void this.probe();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async probe() {
    const url = `${this.settings.issuer}/.well-known/openid-configuration`;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let failure: string | undefined;
    try {
      const res = await fetch(url, { signal: abort.signal });
      await res.body?.cancel();
      if (!res.ok) failure = `HTTP ${res.status}`;
    } catch (error) {
      // The error's code or name only: its message may carry the address,
      // credentials included.
      const { cause, name } = error as Error & { cause?: { code?: string } };
      failure = abort.signal.aborted
        ? `no answer within ${TIMEOUT_MS / 1000} s`
        : (cause?.code ?? name);
    } finally {
      clearTimeout(timeout);
    }
    const up = failure === undefined;
    setIssuerUp(up);
    if (up === this.last) return;
    this.last = up;
    const host = URL.parse(url)?.host ?? 'unparsable issuer';
    if (up) this.logger.log({ host, issuer: 'up' });
    else this.logger.warn({ host, issuer: 'down', reason: failure });
  }
}
