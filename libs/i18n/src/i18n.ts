import { DOCUMENT } from '@angular/common';
import {
  type EnvironmentProviders,
  Injectable,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';

import { FILES, flatten, SHELL_RO } from './files';
import { type Area, isLanguage, type Language } from './languages';

type Params = Record<string, string | number>;

@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly document = inject(DOCUMENT);
  private readonly current = signal<Language>('ro');
  private readonly texts = signal<Record<Language, Record<string, string>>>({
    en: {},
    ro: flatten('shell', SHELL_RO),
  });
  private readonly entered = new Set<Area>(['shell']);
  private readonly loading = new Map<string, Promise<void>>();
  private switches = 0;

  readonly language = this.current.asReadonly();

  async use(language: string): Promise<void> {
    if (!isLanguage(language)) return;
    const turn = ++this.switches;
    await Promise.all([...this.entered].map((a) => this.load(a, language)));
    if (turn !== this.switches) return;
    this.current.set(language);
    this.document.documentElement.lang = language;
  }

  async enter(area: Area): Promise<void> {
    this.entered.add(area);
    await Promise.all([this.load(area, 'ro'), this.load(area, this.current())]);
  }

  t(key: string, params: Params = {}): string {
    const texts = this.texts();
    const language = this.current();
    const text =
      find(texts[language], language, key, params) ??
      find(texts.ro, 'ro', key, params) ??
      key;
    return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
    );
  }

  // A failed load is forgotten, so the next switch or area visit tries again;
  // until then lookups fall back to Romanian.
  private load(area: Area, language: Language): Promise<void> {
    const id = `${area}/${language}`;
    const loader = FILES[area][language];
    if (!loader || this.loading.has(id))
      return this.loading.get(id) ?? Promise.resolve();
    const pending = loader().then(
      (texts) =>
        this.texts.update((all) => ({
          ...all,
          [language]: { ...all[language], ...flatten(area, texts) },
        })),
      () => {
        this.loading.delete(id);
      },
    );
    this.loading.set(id, pending);
    return pending;
  }
}

// The app's one i18n line in app.config: it starts the runtime with the app,
// so <html lang> comes from the current language on every render, server too.
export function provideI18n(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const i18n = inject(I18n);
      inject(DOCUMENT).documentElement.lang = i18n.language();
    }),
  ]);
}

function find(
  texts: Record<string, string>,
  language: Language,
  key: string,
  { count }: Params,
): string | undefined {
  const id =
    typeof count === 'number'
      ? `${key}.${new Intl.PluralRules(language).select(count)}`
      : key;
  const text = Object.hasOwn(texts, id) ? texts[id] : undefined;
  return text?.trim() ? text : undefined;
}
