# Contract: the template module (inside `libs/domain`)

No HTTP or event contract changes. The module's surface for the worker and later stories:

```ts
type Channel = 'email' | 'bell' | 'push' | 'sms' | 'whatsapp';

// Throws TemplateError (kind, channel, reason) when a value is missing,
// a placeholder is undeclared, or a limit is exceeded. A type with no
// template for the e-mail or the bell renders GENERIC.
render(name: string, channel: 'email', language: string, params): { subject; text; html }
render(name, 'bell', language, params): string
render(name, 'push', language, params): { title; body; link }
render(name, 'sms', language, params): string
render(name, 'whatsapp', language, params): { name; params: string[] }

templateName(kind: string, params): string   // ACCOUNT_EMAIL → ACCOUNT_EMAIL.<purpose>
bellText(kind, language, params): string      // never throws: GENERIC on failure
checkTemplates(registry): string[]            // [] when every rule holds
```

Any `language` other than `ro` or `en` renders Romanian.

Brevo call (`POST /v3/smtp/email`) gains `htmlContent` beside `subject` and `textContent`.
