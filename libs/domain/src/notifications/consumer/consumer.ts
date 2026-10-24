import type { Readiness } from '../../health/health.service';

interface Closable {
  close(): Promise<unknown>;
}

// The notifications queue's consumer, opened once the start-up check passes,
// which may take a Brevo outage; the worker's health waits on it meanwhile.
export class NotificationsConsumer implements Readiness {
  private worker: Closable | null = null;
  private started = false;
  private readonly stop = new AbortController();

  constructor(
    private readonly check: (signal: AbortSignal) => Promise<boolean>,
    private readonly open: () => Promise<Closable>,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
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
