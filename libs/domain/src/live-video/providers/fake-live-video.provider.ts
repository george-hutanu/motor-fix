import { randomUUID } from 'node:crypto';

import type {
  InputStatus,
  LiveInput,
  LiveVideoProvider,
} from './live-video.provider';

const HOST = 'https://live.motorfix.test';

// The stand-in for tests and local runs: every input opens, nothing streams.
export class FakeLiveVideo implements LiveVideoProvider {
  readonly name = 'fake';
  // The recordings deleted, in order, for the tests to read.
  readonly deleted: string[] = [];
  // The inputs closed, in order, for the tests to read.
  readonly closed: string[] = [];
  // The publisher state of each input, set by the tests; an input not set
  // never had a publisher.
  readonly statuses = new Map<string, InputStatus>();

  async createInput(_session: { id: string }): Promise<LiveInput> {
    const inputId = randomUUID();
    return { inputId, publishUrl: `${HOST}/${inputId}/webRTC/publish` };
  }

  async closeInput(inputId: string): Promise<void> {
    this.closed.push(inputId);
  }

  async deleteRecording(providerRef: string): Promise<void> {
    this.deleted.push(providerRef);
  }

  async inputStatus(inputId: string): Promise<InputStatus> {
    return this.statuses.get(inputId) ?? { connected: false, since: null };
  }

  viewUrl(inputId: string, expiresAt: Date): string {
    const exp = Math.floor(expiresAt.getTime() / 1000);
    return `${HOST}/${inputId}/manifest/video.m3u8?protocol=llhls&exp=${exp}`;
  }
}
