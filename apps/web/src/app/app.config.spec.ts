/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  createEnvironmentInjector,
  type EnvironmentInjector,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  Injector,
  PLATFORM_ID,
  provideZonelessChangeDetection,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { apiHttpClient } from './app.config';

let server: Server;
let base: string;
let connections: number;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{}');
  });
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  connections = 0;
});

// The app's own HttpClient on a server's root injector, in Node, where
// withFetch reaches Node's global fetch; no page is rendered, so no DOM.
const serverHttp = () =>
  createEnvironmentInjector(
    [
      apiHttpClient(),
      { provide: INJECTOR_SCOPE, useValue: 'root' },
      { provide: PLATFORM_ID, useValue: 'server' },
      provideZonelessChangeDetection(),
      {
        provide: DOCUMENT,
        useValue: { location: { origin: 'http://web.test' } },
      },
    ],
    Injector.NULL as EnvironmentInjector,
  ).get(HttpClient);

// @traces 1188-FR-001
describe("the server render's connection to the API", () => {
  it('reuses its kept-alive connections across calls one after another', async () => {
    const http = serverHttp();
    for (let call = 0; call < 10; call += 1) {
      await firstValueFrom(http.get(`${base}/api/v1/home`));
    }

    // undici may open a second socket while the first is being handed back
    // to the pool; without keep-alive each of the ten calls opens its own.
    expect(connections).toBeLessThanOrEqual(2);
  });
});
