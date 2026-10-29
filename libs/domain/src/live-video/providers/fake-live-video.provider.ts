import { randomUUID } from 'node:crypto';

import type { LiveInput, LiveVideoProvider } from './live-video.provider';

const HOST = 'https://live.motorfix.test';

// The stand-in for tests and local runs: every input opens, nothing streams.
export class FakeLiveVideo implements LiveVideoProvider {
  readonly name = 'fake';
  // The recordings deleted, in order, for the tests to read.
  readonly deleted: string[] = [];

  async createInput(_session: { id: string }): Promise<LiveInput> {
    const inputId = randomUUID();
    return { inputId, publishUrl: `${HOST}/${inputId}/webRTC/publish` };
  }

  async closeInput(_inputId: string): Promise<void> {}

  async deleteRecording(providerRef: string): Promise<void> {
    this.deleted.push(providerRef);
  }

  viewUrl(inputId: string, expiresAt: Date): string {
    const exp = Math.floor(expiresAt.getTime() / 1000);
    return `${HOST}/${inputId}/manifest/video.m3u8?protocol=llhls&exp=${exp}`;
  }
}
