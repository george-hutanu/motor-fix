// The test mailbox: a stand-in for Brevo's transactional API that keeps what
// the worker sends, so a test reads an e-mail as it left. Never a real account.
//
//   POST /v3/smtp/email   keeps the message, answers 201 with a messageId
//   GET  /v3/account      answers 200, so the worker accepts its key
//   GET  /messages?to=a   the messages kept for address a, oldest first
import { createServer } from 'node:http';

const port = 3025;
const messages = [];

const answer = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    if (req.method === 'POST' && url.pathname === '/v3/smtp/email') {
      try {
        messages.push(JSON.parse(raw));
      } catch {
        return answer(res, 400, { code: 'bad_request' });
      }
      return answer(res, 201, {
        messageId: `<e2e-${messages.length}@mailbox>`,
      });
    }
    if (url.pathname === '/v3/account') {
      return answer(res, 200, { email: 'mailbox@example.test' });
    }
    if (url.pathname === '/messages') {
      const to = url.searchParams.get('to')?.toLowerCase();
      return answer(
        res,
        200,
        messages.filter((m) => m.to.some((r) => r.email.toLowerCase() === to)),
      );
    }
    answer(res, 404, { code: 'not_found' });
  });
}).listen(port, '127.0.0.1');
