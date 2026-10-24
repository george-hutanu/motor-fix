import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { injectTag } from '../telemetry-meta/telemetry-meta';

// The map on the results draws its tiles from here (OpenFreeMap).
const TILES = 'https://tiles.openfreemap.org';
const RESULTS = /^\/(ro|en)\/garages(?:\?|$)/;
const ENGLISH = /^\/en(?:[/?#]|$)/;
// The heading font's files: Latin Extended holds the Romanian ș and ț.
const FONTS = {
  en: 'michroma-latin-400-normal',
  ro: 'michroma-latin-ext-400-normal',
} as const;

type HeadHints = {
  fonts: Record<keyof typeof FONTS, string>;
  images: string | undefined;
};

// The build names each font file after its content; without a build (the dev
// server) the file keeps its own name.
function fontFile(media: readonly string[], name: string): string {
  const built = new RegExp(`^${name}(?:-[A-Za-z0-9]+)?\\.woff2$`);
  return `/media/${media.find((file) => built.test(file)) ?? `${name}.woff2`}`;
}

function listed(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

// What the pages hint, worked out once at start-up: the image server's origin
// when it is not the page's own, and the heading font file of each language.
export function headHints(given: {
  distFolder: string;
  imageBase: string;
  siteOrigin: string | undefined;
}): HeadHints {
  const media = listed(join(given.distFolder, 'media'));
  const absolute = URL.canParse(given.imageBase)
    ? new URL(given.imageBase).origin
    : undefined;
  return {
    fonts: { en: fontFile(media, FONTS.en), ro: fontFile(media, FONTS.ro) },
    images: absolute !== given.siteOrigin ? absolute : undefined,
  };
}

// Tells the browser, before `</head>` of a rendered page, which servers to
// connect to ahead of time and which heading font file it will need: the
// image server everywhere, the map tiles on the results only, and the font of
// the page's language. At most two connections and one font.
export async function withHeadHints(
  path: string,
  response: Response,
  hints: HeadHints,
): Promise<Response> {
  const html = response.headers.get('content-type')?.startsWith('text/html');
  if (!html || !response.body) return response;
  const font = ENGLISH.test(path) ? hints.fonts.en : hints.fonts.ro;
  const tag =
    (hints.images ? `<link rel="preconnect" href="${hints.images}">` : '') +
    (RESULTS.test(path)
      ? `<link rel="preconnect" href="${TILES}" crossorigin>`
      : '') +
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="${font}">`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(response.body.pipeThrough(injectTag(tag)), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
