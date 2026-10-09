import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from 'jose';

export const TEST_MCP_URL = 'http://127.0.0.1:3002/mcp';

interface Key {
  kid: string;
  privateKey: CryptoKey;
  jwk: JWK;
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

const keyPair = () => generateKeyPair('RS256', { extractable: true });

async function newKey(
  kid: string = randomUUID(),
  pair?: KeyPair,
): Promise<Key> {
  const { privateKey, publicKey } = pair ?? (await keyPair());
  return {
    jwk: { ...(await exportJWK(publicKey)), alg: 'RS256', kid, use: 'sig' },
    kid,
    privateKey,
  };
}

interface SignOptions {
  claims?: JWTPayload;
  // Claims left out of the token.
  omit?: string[];
  // A key the issuer never published.
  unpublished?: boolean;
  // Signed by another key that claims the published key's id.
  forged?: boolean;
}

// An identity server realm on a local port: its key set at Keycloak's path,
// a count of the requests made to it, and tokens it signs.
export async function testIssuer(audience = TEST_MCP_URL) {
  let keys = [await newKey()];
  // One pair for every unpublished key: generating an RSA key per token is
  // slow enough to time a loop of them out on a busy runner.
  let stranger: KeyPair | undefined;
  const keyRequests: IncomingHttpHeaders[] = [];
  const server: Server = createServer((req, res) => {
    keyRequests.push({ ...req.headers, url: req.url });
    if (req.url !== '/realms/motorfix-assistants/protocol/openid-connect/certs')
      return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: keys.map((k) => k.jwk) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/motorfix-assistants`;

  async function sign(options: SignOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: JWTPayload = {
      aud: audience,
      azp: 'https://claude.ai/oauth/mcp-client',
      exp: now + 900,
      iat: now,
      iss: issuer,
      motorfix_account_id: randomUUID(),
      scope: 'openid motorfix.read motorfix.act',
      sub: randomUUID(),
      ...options.claims,
    };
    for (const name of options.omit ?? []) delete claims[name];
    const published = keys[keys.length - 1] as Key;
    if (options.unpublished) stranger ??= await keyPair();
    const key = options.unpublished
      ? await newKey(randomUUID(), stranger)
      : options.forged
        ? await newKey(published.kid)
        : published;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .sign(key.privateKey);
  }

  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    issuer,
    keyRequests,
    // Publishes a new signing key next to the old one, as a key rotation does.
    async rotate() {
      keys = [...keys, await newKey()];
    },
    sign,
  };
}

export type TestIssuer = Awaited<ReturnType<typeof testIssuer>>;
