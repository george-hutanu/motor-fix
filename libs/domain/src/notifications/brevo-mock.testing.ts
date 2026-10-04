import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

interface RecordedCall {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

interface Reply {
  status: number;
  body?: unknown;
  // Never answer, so the caller's timeout fires.
  hang?: boolean;
}

// Brevo's transactional API as recorded: POST /smtp/email answers 201 with a
// messageId, GET /account answers 200 for a good key and 401 for a bad one.
export class BrevoMock {
  readonly calls: RecordedCall[] = [];
  private replies: Reply[] = [];
  private server?: Server;
  private sent = 0;

  url = '';

  async start() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => this.reply(req, res, raw));
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}/v3`;
  }

  async stop() {
    this.server?.closeAllConnections();
    await new Promise((resolve) => this.server?.close(resolve));
  }

  reset() {
    this.calls.length = 0;
    this.replies = [];
  }

  // The next answers, in order; after them the recorded defaults.
  answer(...replies: Reply[]) {
    this.replies.push(...replies);
  }

  emails() {
    return this.calls.filter((c) => c.path === '/v3/smtp/email');
  }

  private reply(req: IncomingMessage, res: ServerResponse, raw: string) {
    const path = req.url ?? '';
    this.calls.push({
      body: raw ? JSON.parse(raw) : undefined,
      headers: req.headers,
      method: req.method ?? '',
      path,
    });
    const reply = this.replies.shift() ?? this.default(path);
    if (reply.hang) return;
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  }

  private default(path: string): Reply {
    if (path === '/v3/account')
      return { body: { email: 'owner@example.test' }, status: 200 };
    this.sent += 1;
    return {
      body: { messageId: `<mock-${this.sent}@smtp-relay.mailin.fr>` },
      status: 201,
    };
  }
}
