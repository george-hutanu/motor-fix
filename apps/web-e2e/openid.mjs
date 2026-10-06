// The stand-in OpenID issuer for the end-to-end suite: the api reads it as
// Google (GOOGLE_ISSUER) in development and test only. Never a real account.
//
//   POST /next       sets who the next sign-in is ({ sub, email,
//                    email_verified, name }), or { deny: true } for a cancel
//   GET  /authorize  approves at once and redirects back with a code
//   POST /token      checks the PKCE verifier, answers a signed ID token
//   GET  /.well-known/openid-configuration, /jwks
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { createServer } from 'node:http';

const port = 3026;
const issuer = `http://127.0.0.1:${port}`;
const kid = 'e2e-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const grants = new Map();
let next = { email: 'e2e@example.test', email_verified: true, sub: 'e2e' };

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function idToken(claims) {
  const data = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode(claims)}`;
  const signature = createSign('sha256')
    .update(data)
    .sign(privateKey)
    .toString('base64url');
  return `${data}.${signature}`;
}

function authorize(url) {
  const param = (name) => url.searchParams.get(name) ?? '';
  const back = new URL(param('redirect_uri'));
  back.searchParams.set('state', param('state'));
  if (next.deny) {
    back.searchParams.set('error', 'access_denied');
    return back;
  }
  const code = randomBytes(16).toString('hex');
  grants.set(code, {
    challenge: param('code_challenge'),
    clientId: param('client_id'),
    nonce: param('nonce'),
    person: { ...next },
  });
  back.searchParams.set('code', code);
  return back;
}

function token(form) {
  const code = form.get('code') ?? '';
  const grant = grants.get(code);
  grants.delete(code);
  const challenge = createHash('sha256')
    .update(form.get('code_verifier') ?? '')
    .digest('base64url');
  if (!grant || grant.challenge !== challenge) {
    return [400, { error: 'invalid_grant' }];
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: grant.clientId,
    exp: now + 600,
    iat: now,
    iss: issuer,
    nonce: grant.nonce,
    ...grant.person,
  };
  return [200, { id_token: idToken(claims), token_type: 'Bearer' }];
}

function published(path) {
  if (path === '/.well-known/openid-configuration') {
    return [
      200,
      {
        authorization_endpoint: `${issuer}/authorize`,
        issuer,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint: `${issuer}/token`,
      },
    ];
  }
  if (path === '/jwks') {
    const jwk = publicKey.export({ format: 'jwk' });
    return [200, { keys: [{ ...jwk, alg: 'RS256', kid, use: 'sig' }] }];
  }
  return [404, { error: 'not_found' }];
}

function answer(req, url, raw) {
  if (req.method === 'POST' && url.pathname === '/next') {
    try {
      next = JSON.parse(raw);
    } catch {
      return [400, { error: 'bad_request' }];
    }
    return [204, null];
  }
  if (req.method === 'POST' && url.pathname === '/token') {
    return token(new URLSearchParams(raw));
  }
  return published(url.pathname);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', issuer);
  if (url.pathname === '/authorize') {
    res.writeHead(302, { location: authorize(url).toString() });
    res.end();
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    const [status, body] = answer(req, url, raw);
    res.writeHead(status, body ? { 'content-type': 'application/json' } : {});
    res.end(body ? JSON.stringify(body) : undefined);
  });
}).listen(port, '127.0.0.1');
