import type { BrowserContext, Route } from '@playwright/test';

type Answer = { status: number; contentType?: string; body: Buffer };

// Every test opens a fresh browser context, which would download the app's
// scripts again. Content-hashed files never change at one address, so a worker
// fetches each once and answers later requests from memory.
const answers = new Map<string, Answer>();

export const isHashedAsset = (url: URL, origin: string) =>
  url.origin === origin &&
  /-[A-Za-z0-9]{8}\.(?:js|css|woff2)$/.test(url.pathname);

async function serveFromCache(route: Route) {
  const url = route.request().url();
  let answer = answers.get(url);
  if (!answer) {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    // The fetched body is already decoded, so the encoding headers stay behind.
    answer = {
      body: await response.body(),
      contentType: response.headers()['content-type'],
      status: response.status(),
    };
    answers.set(url, answer);
  }
  await route.fulfill(answer);
}

export const cacheAssets = (context: BrowserContext, origin: string) =>
  context.route((url) => isHashedAsset(url, origin), serveFromCache);
