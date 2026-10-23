import type { Readiness } from '../../health/health.service';

const FIRST_MS = 1_000;
const CAP_MS = 60_000;

// The wait after the n-th start-up key check that could not reach Brevo.
export const keyRetryDelay = (failed: number) =>
  Math.min(FIRST_MS * 2 ** (failed - 1), CAP_MS);

interface Closable {
  close(): Promise<unknown>;
}

// The notifications queue's consumer, opened once the start-up check passes,
// which may take a Brevo outage; the worker's health waits on it meanwhile.
export class NotificationsConsumer<W extends Closable = Closable>
  implements Readiness
{
  private worker: W | null = null;
  private readonly stop = new AbortController();

  constructor(
    private readonly check: (signal: AbortSignal) => Promise<boolean>,
    private readonly open: () => Promise<W>,
  ) {}

  async start(): Promise<void> {
    if (!(await this.check(this.stop.signal)) || this.stop.signal.aborted)
      return;
    const worker = await this.open();
    if (this.stop.signal.aborted) await worker.close();
    else this.worker = worker;
  }

  ready(): boolean {
    return this.worker !== null;
  }

  async close(): Promise<void> {
    this.stop.abort();
    const worker = this.worker;
    this.worker = null;
    await worker?.close();
  }
}
