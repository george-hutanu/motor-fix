import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  type OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { expect, type Page } from '@playwright/test';

import { signIn } from './accounts.js';

export const MCP_URL = process.env['MCP_URL'] ?? '';
export const ISSUER = process.env['ASSISTANT_ISSUER'] ?? '';
// The identity server runs in a container and reaches this process by this name.
const HOST = 'host.docker.internal';

// An assistant as the identity server sees it: a client document served from
// this process, and a callback the browser cannot resolve: the test reads the
// code off the request.
async function assistantHost() {
  let document: object = {};
  const server: Server = createServer((request, response) => {
    if (request.url !== '/client.json') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(document));
  });
  await new Promise<void>((done) => server.listen(0, '0.0.0.0', done));
  const base = `http://${HOST}:${(server.address() as AddressInfo).port}`;
  return {
    callback: `${base}/callback`,
    clientId: `${base}/client.json`,
    close: () => new Promise<void>((done) => server.close(() => done())),
    publish: (body: object) => {
      document = body;
    },
  };
}

function provider(
  callback: string,
  client: OAuthClientInformationMixed | undefined,
): OAuthClientProvider & { authorizationUrl?: URL } {
  let information = client;
  let tokens: OAuthTokens | undefined;
  let verifier = '';
  const metadata: OAuthClientMetadata = {
    client_name: 'MotorFix test assistant',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: [callback],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
  const self: OAuthClientProvider & { authorizationUrl?: URL } = {
    clientInformation: () => information,
    clientMetadata: metadata,
    codeVerifier: () => verifier,
    redirectToAuthorization: (url) => {
      self.authorizationUrl = url;
    },
    redirectUrl: callback,
    saveClientInformation: (saved) => {
      information = saved;
    },
    saveCodeVerifier: (saved) => {
      verifier = saved;
    },
    saveTokens: (saved) => {
      tokens = saved;
    },
    tokens: () => tokens,
  };
  return self;
}

// The person's side: sign in on MotorFix, approve on the consent screen, and
// hand the code the identity server sends back.
async function approve(page: Page, url: URL, callback: string, email: string) {
  const callbackSent = page.waitForRequest((request) =>
    request.url().startsWith(callback),
  );
  await page.goto(url.toString());
  await signIn(page, email);
  await expect(
    page.getByText('Read your MotorFix account, cars, requests and bookings'),
  ).toBeVisible();
  await page.locator('#kc-login').click();
  const sent = await callbackSent;
  return new URL(sent.url()).searchParams.get('code') ?? '';
}

// An assistant connected as the person `email` signs in as, through the
// identity server's consent screen.
export async function connect(
  page: Page,
  email: string,
  withDocument: boolean,
) {
  const host = await assistantHost();
  const clientMetadata = {
    client_id: host.clientId,
    client_name: 'MotorFix test assistant',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: [host.callback],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
  host.publish(clientMetadata);
  const auth = provider(
    host.callback,
    withDocument ? { client_id: host.clientId } : undefined,
  );
  try {
    const first = new Client({ name: 'test assistant', version: '1.0.0' });
    await expect(
      first.connect(
        new StreamableHTTPClientTransport(new URL(MCP_URL), {
          authProvider: auth,
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(auth.authorizationUrl?.origin).toBe(new URL(ISSUER).origin);
    const code = await approve(
      page,
      auth.authorizationUrl as URL,
      host.callback,
      email,
    );
    expect(code).not.toBe('');
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      authProvider: auth,
    });
    await transport.finishAuth(code);
    const assistant = new Client({ name: 'test assistant', version: '1.0.0' });
    await assistant.connect(transport);
    return { assistant, host };
  } catch (error) {
    await host.close();
    throw error;
  }
}
