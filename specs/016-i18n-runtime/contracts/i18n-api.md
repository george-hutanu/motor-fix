# Contract: `@motor-fix/i18n` public API

What ST-17 (switch), ST-19 (formats), ST-21 (addresses), ST-157 (dialog) and
every screen build on.

```ts
export const LANGUAGES: readonly ['ro', 'en'];
export type Language = (typeof LANGUAGES)[number];
export const AREAS: readonly ['shell', 'public', 'driver', 'garage', 'mechanic', 'admin'];
export type Area = (typeof AREAS)[number];

@Injectable({ providedIn: 'root' })
export class I18n {
  /** Current language; read it in a computed/effect to react to a change. */
  readonly language: Signal<Language>;
  /** Loads the language's files for every entered area, then switches.
   *  Unknown values are ignored. The last call wins. Sets <html lang>. */
  use(language: string): Promise<void>;
  /** Loads an area's Romanian file and, if current, its English file.
   *  Call from a route resolver: resolve: { i18n: () => inject(I18n).enter('garage') } */
  enter(area: Area): Promise<void>;
  /** Text for a dotted key in the current language, Romanian when missing.
   *  params.count (number) selects the plural category. */
  t(key: string, params?: Record<string, string | number>): string;
}

/** {{ 'shell.brand' | t }} · {{ 'garage.list.count' | t: { count: n } }} */
@Pipe({ name: 't', pure: false }) export class TranslatePipe {}
```

Rules:

- Keys are `<area>.<screen>.<text>` in the templates; the files omit the area
  prefix (it is the folder).
- A key missing in both languages returns the key itself — the checks make
  that unreachable in shipped code.
- Server rendering is always Romanian until ST-21 passes a language in.
