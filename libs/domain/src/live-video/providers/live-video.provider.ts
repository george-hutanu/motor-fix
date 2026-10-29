// Why an input could not be opened: a status, `timeout`, `network`,
// `malformed`, `rejected` or `not_configured`. Logged and counted, never
// sent on.
export type LiveInput =
  | { inputId: string; publishUrl: string }
  | { unavailable: string };

export interface LiveVideoProvider {
  readonly name: 'cloudflare' | 'fake' | 'none';
  createInput(session: { id: string }): Promise<LiveInput>;
  // Throws when the input could not be closed; the caller logs it.
  closeInput(inputId: string): Promise<void>;
  // The signed low-latency HLS manifest of the input, valid until expiresAt.
  viewUrl(inputId: string, expiresAt: Date): string;
  // Deletes every recording of a live input, the reference a recording is
  // kept under; one already gone counts as deleted. Throws when the provider
  // could not delete it, so the caller keeps its own row.
  deleteRecording(providerRef: string): Promise<void>;
}

export const LIVE_VIDEO_PROVIDER = Symbol('LIVE_VIDEO_PROVIDER');

export const NONE: LiveVideoProvider = {
  closeInput: async () => undefined,
  createInput: async () => ({ unavailable: 'not_configured' }),
  deleteRecording: async () => undefined,
  name: 'none',
  viewUrl: () => {
    throw new Error('live video is not configured');
  },
};
