import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

// The tags the CDN keeps pages under: a garage's profile and every search
// page. A sign-in warm tag (`warm:*`) never leaves the worker.
const CDN_TAG = /^(garage:[^\s:]+|search)$/;

// The tags waiting for the next send: a set, so a tag purged ten times in
// five seconds is sent once.
const CDN_PURGE_KEY = 'cdn:purge';

const INTERVAL_MS = 5_000;
// Ten calls every five seconds, well under the provider's rate.
const BATCH = 10;
const TIMEOUT_MS = 10_000;

// The hook `purgeAudience` calls per tag: queues the CDN's own tags.
export function cdnPurgeHook(
  redis: { sadd(key: string, ...members: string[]): Promise<unknown> },
  key = CDN_PURGE_KEY,
) {
  return async (tag: string) => {
    if (CDN_TAG.test(tag)) await redis.sadd(key, tag);
  };
}

interface PurgeQueue {
  sadd(key: string, ...members: string[]): Promise<unknown>;
  spop(key: string, count: number): Promise<string[]>;
}

// Every five seconds, up to ten queued tags go to the pull zone's tag purge,
// one call each; a tag the CDN did not take goes back for the next tick.
export class CdnPurgeSender {
  private readonly logger = new Logger('CdnPurge');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(
    private readonly redis: PurgeQueue,
    private readonly config: { apiKey: string; pullZoneId: string },
    private readonly send: typeof fetch = fetch,
    private readonly key = CDN_PURGE_KEY,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  async tick() {
    let tags: string[];
    try {
      tags = await this.redis.spop(this.key, BATCH);
    } catch (error) {
      this.logger.warn(`cdn purge queue unavailable: ${String(error)}`);
      return;
    }
    // Only the CDN's own tags leave, whatever else reached the set.
    for (const tag of tags) if (CDN_TAG.test(tag)) await this.purge(tag);
  }

  // The next tick waits for this one to end, so two never overlap.
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
        this.schedule();
      });
    }, INTERVAL_MS);
  }

  private async purge(tag: string) {
    let failure: string | undefined;
    try {
      const answer = await this.send(
        `https://api.bunny.net/pullzone/${this.config.pullZoneId}/purgeCache`,
        {
          body: JSON.stringify({ CacheTag: tag }),
          headers: {
            AccessKey: this.config.apiKey,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!answer.ok) failure = `status ${answer.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.name : 'error';
    }
    countPurge(failure ? 'failed' : 'sent');
    if (!failure) return;
    this.logger.warn(`cdn purge failed ${tag} ${failure}`);
    await this.redis.sadd(this.key, tag).catch(() => undefined);
  }
}

// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op.
function countPurge(outcome: 'sent' | 'failed') {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_cdn_purges_total', {
      description: 'Tag purges sent to the CDN, by outcome',
    })
    .add(1, { outcome });
}
