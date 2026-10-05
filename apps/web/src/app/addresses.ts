import { DOCUMENT, isPlatformServer } from '@angular/common';
import {
  ApplicationRef,
  type EnvironmentProviders,
  effect,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  PLATFORM_ID,
  provideEnvironmentInitializer,
  untracked,
} from '@angular/core';
import {
  type CanMatchFn,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  type UrlMatcher,
  UrlSegment,
  type UrlTree,
} from '@angular/router';
import {
  I18n,
  isLanguage,
  LANGUAGES,
  type Language,
  LanguageChoice,
} from '@motor-fix/i18n';

// The paths after the language prefix that search engines may list. The public
// pages of later stories add theirs.
export const PUBLIC_PATHS: readonly string[] = [''];

// The server provides PUBLIC_WEB_URL's origin: behind the host's proxy the
// request may arrive as http.
export const SITE_ORIGIN = new InjectionToken<string>('SITE_ORIGIN', {
  factory: () => inject(DOCUMENT).location.origin,
});

export function alternates(origin: string, path: string) {
  const address = (language: string) => `${origin}/${language}/${path}`;
  const links: Record<string, string> = { 'x-default': address('ro') };
  for (const language of LANGUAGES) links[language] = address(language);
  return links;
}

// The language comes from the address, before the page renders, so the server
// and the browser render the same language; it also becomes the remembered one.
// The public screens' texts load first for the same reason.
export const languageAddress: CanMatchFn = async (_route, [first]) => {
  if (!first || !isLanguage(first.path)) return false;
  const texts = inject(I18n).enter('public');
  await inject(LanguageChoice).choose(first.path);
  await texts;
  return true;
};

// `/ro` and the canonical `/ro/`: in-app, the router keeps the trailing slash as
// one empty segment.
export const languageRoot: UrlMatcher = (segments) =>
  segments.length === 0 || (segments.length === 1 && segments[0].path === '')
    ? { consumed: segments }
    : null;

// The public frame's own texts, for `/`: the server renders the frame there;
// in the browser the redirect wins and the load is one /<lang> needs anyway.
export const publicTexts: CanMatchFn = async () => {
  await inject(I18n).enter('public');
  return true;
};

// The server cannot read the device's memory, so `/` stays Romanian there; the
// browser goes on to the address of the remembered or current language. The
// first page is the server's `/`: it hydrates where it is, so a tap made before
// the app loaded is replayed onto it, and moves once the replay has run.
export const toLanguageAddress: CanMatchFn = () => {
  if (isPlatformServer(inject(PLATFORM_ID))) return true;
  const router = inject(Router);
  const address = languageTree(router);
  if (router.navigated)
    return address(router.currentNavigation()?.extractedUrl);
  // A replayed tap may still be loading its texts, and with storage blocked
  // nothing else holds it.
  let tapped: Language | undefined;
  const taps = inject(LanguageChoice).taps.subscribe((language) => {
    tapped = language;
  });
  void inject(ApplicationRef)
    .whenStable()
    // The replay runs in its own whenStable callback; a task later, it is done.
    .then(() => new Promise((resolve) => setTimeout(resolve)))
    .then(() => {
      taps.unsubscribe();
      const here = router.parseUrl(router.url);
      if (segmentsOf(here).length === 0)
        void router.navigateByUrl(address(here, tapped), { replaceUrl: true });
    });
  return true;
};

function languageTree(router: Router) {
  const choice = inject(LanguageChoice);
  const i18n = inject(I18n);
  return (from: UrlTree | undefined, tapped?: Language) =>
    router.createUrlTree([tapped ?? choice.saved() ?? i18n.language()], {
      fragment: from?.fragment ?? undefined,
      queryParams: from?.queryParams,
    });
}

export function provideLanguageAddresses(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const router = inject(Router);
      const i18n = inject(I18n);
      const document = inject(DOCUMENT);
      const origin = inject(SITE_ORIGIN);

      const align = (url: string) => {
        const language = i18n.language();
        const tree = router.parseUrl(url);
        const segments = tree.root.children[PRIMARY_OUTLET]?.segments;
        const first = segments?.[0]?.path;
        if (!segments || !first || !isLanguage(first) || first === language)
          return;
        segments[0] = new UrlSegment(language, {});
        void router.navigateByUrl(tree, { replaceUrl: true });
      };

      // A language chosen on the page or in another tab moves the address. While
      // a navigation runs, its own guard sets the language, and a change that
      // lands meanwhile is caught when it ends.
      effect(() => {
        i18n.language();
        untracked(() => {
          if (!router.currentNavigation()) align(router.url);
        });
      });

      router.events.subscribe((event) => {
        if (!(event instanceof NavigationEnd)) return;
        align(event.urlAfterRedirects);
        writeHead(document, origin, publicAddress(router));
      });
    }),
  ]);
}

// A page is public when it was matched under the language prefix, or is `/`,
// which shows Romanian Home.
function publicAddress(router: Router) {
  const top = router.routerState.snapshot.root.firstChild;
  const prefix: string | undefined = top?.params['lang'];
  if (!prefix && top?.routeConfig?.path !== '') return null;
  const segments =
    router.parseUrl(router.url).root.children[PRIMARY_OUTLET]?.segments ?? [];
  return {
    language: prefix ?? 'ro',
    path: segments
      .slice(prefix ? 1 : 0)
      .map((s) => s.path)
      .join('/'),
  };
}

const TAGS =
  'link[rel="canonical"], link[rel="alternate"][hreflang], meta[name="robots"]';

function writeHead(
  document: Document,
  origin: string,
  address: { language: string; path: string } | null,
) {
  const add = (name: string, attributes: Record<string, string>) => {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attributes))
      element.setAttribute(key, value);
    document.head.appendChild(element);
  };
  document.head.querySelectorAll(TAGS).forEach((tag) => {
    tag.remove();
  });
  if (!address) return add('meta', { content: 'noindex', name: 'robots' });
  const links = alternates(origin, address.path);
  add('link', { href: links[address.language], rel: 'canonical' });
  for (const [hreflang, href] of Object.entries(links))
    add('link', { href, hreflang, rel: 'alternate' });
}

// ['app', 'driver', …] of an address, without its query or fragment.
export const segmentsOf = (tree: UrlTree) =>
  tree.root.children[PRIMARY_OUTLET]?.segments.map((s) => s.path) ?? [];
