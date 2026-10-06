// The test mailbox: a stand-in for Brevo's transactional API that keeps what
// the worker sends, so a test reads an e-mail as it left. Never a real account.
//
//   POST /v3/smtp/email   keeps the message, answers 201 with a messageId
//   GET  /v3/account      answers 200, so the worker accepts its key
//   GET  /messages?to=a   the messages kept for address a, oldest first
//   POST /v3/whatsapp/sendMessage   keeps the WhatsApp message, likewise
//   GET  /whatsapp?to=n   the WhatsApp messages kept for number n (digits,
//                         as Brevo takes them), oldest first
//
// WhatsApp to REFUSED is answered 400, as Brevo answers a number it cannot
// reach, so a test sees the sign-in's fallback.
import { createServer } from 'node:http';

const port = 3025;
const messages = [];
const whatsapp = [];
const REFUSED = '40700009999';

const answer = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Keeps a posted message in `into`, answering as Brevo does.
const keep = (into, id) => (res, raw) => {
  try {
    into.push(JSON.parse(raw));
  } catch {
    return answer(res, 400, { code: 'bad_request' });
  }
  return answer(res, 201, { messageId: id(into.length) });
};

const keepWhatsapp = keep(whatsapp, (n) => `e2e-wa-${n}`);

const POSTS = {
  '/v3/smtp/email': keep(messages, (n) => `<e2e-${n}@mailbox>`),
  '/v3/whatsapp/sendMessage': (res, raw) =>
    raw.includes(`"${REFUSED}"`)
      ? answer(res, 400, { code: 'invalid_parameter' })
      : keepWhatsapp(res, raw),
};

const GETS = {
  '/messages': (to) =>
    messages.filter((m) =>
      (m.to ?? []).some((r) => r.email.toLowerCase() === to?.toLowerCase()),
    ),
  '/v3/account': () => ({ email: 'mailbox@example.test' }),
  '/whatsapp': (to) =>
    whatsapp.filter((m) =>
      (m.contactNumbers ?? []).includes(to?.replace(/^\+/, '')),
    ),
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    const post = req.method === 'POST' && POSTS[url.pathname];
    if (post) return post(res, raw);
    const get = Object.hasOwn(GETS, url.pathname) && GETS[url.pathname];
    if (get) return answer(res, 200, get(url.searchParams.get('to')));
    answer(res, 404, { code: 'not_found' });
  });
}).listen(port, '127.0.0.1');
