import type { Area, Language } from './languages';
import shellRo from './shell/ro.json';

export interface Texts {
  [key: string]: string | Texts;
}

type Loaders = Partial<Record<Language, () => Promise<Texts>>>;

// Literal import() paths let the bundler emit every file as its own chunk, so
// an area's texts are fetched only when that area is entered. The shell's
// Romanian is bundled: server and browser render the first page from it
// synchronously, so hydration sees the same text.
export const SHELL_RO: Texts = shellRo;

export const FILES: Record<Area, Loaders> = {
  admin: {
    en: () => import('./admin/en.json').then((m) => m.default),
    ro: () => import('./admin/ro.json').then((m) => m.default),
  },
  driver: {
    en: () => import('./driver/en.json').then((m) => m.default),
    ro: () => import('./driver/ro.json').then((m) => m.default),
  },
  garage: {
    en: () => import('./garage/en.json').then((m) => m.default),
    ro: () => import('./garage/ro.json').then((m) => m.default),
  },
  mechanic: {
    en: () => import('./mechanic/en.json').then((m) => m.default),
    ro: () => import('./mechanic/ro.json').then((m) => m.default),
  },
  public: {
    en: () => import('./public/en.json').then((m) => m.default),
    ro: () => import('./public/ro.json').then((m) => m.default),
  },
  shell: {
    en: () => import('./shell/en.json').then((m) => m.default),
  },
};

export function flatten(prefix: string, texts: Texts): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(texts)) {
    if (typeof value === 'string') flat[`${prefix}.${key}`] = value;
    else Object.assign(flat, flatten(`${prefix}.${key}`, value));
  }
  return flat;
}
