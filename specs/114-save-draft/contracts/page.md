# Contract: the page, the e-mails and the timers

## Page `/<lang>/list-your-garage` (`apps/web/src/app/public/list-your-garage.ts`)

Additions to ST-108's page; everything else there stays.

### Response header (FR-021)

The SSR response for `/<lang>/list-your-garage` sends `Referrer-Policy: no-referrer` (set in `apps/web/src/server/search.ts`, beside the `X-Robots-Tag` precedent in `search.ts`, for the route whose query holds `?draft=`), so the token reaches no third party; the page also replaces the URL without the query once the draft is loaded.

### Step 1's section

- `<label for="listing-email">E-mail</label>` + `<input id="listing-email" type="email" autocomplete="email" hlmInput>`; `aria-describedby` points at the field's error `<p id="listing-email-error">` when shown and at the hint `<p id="listing-email-hint">` otherwise.
- On `blur` with a valid address and no server copy → `POST /listing-drafts`; with a server copy and a changed address → `PATCH` with `email`.
- Invalid address on blur → error text, no request. The field is also highlighted (error style + focus) when the button is pressed without an address.

### Actions

- `<button type="button" hlmBtn variant="secondary">` "Salvează ciorna" / "Save draft", 44 px, placed in a `.actions` row after the sections (room for ST-116's primary button beside it).
- One `<p role="status" aria-live="polite" class="note">` under the actions carries the current note (one at a time, latest wins).

### Texts (`libs/i18n/src/public/{ro,en}.json`, group `listing`)

| Key | RO | EN |
| --- | --- | --- |
| `email` | E-mail | E-mail |
| `emailHint` | Îți trimitem un link ca să continui de pe orice dispozitiv. | We e-mail you a link to continue on any device. |
| `emailInvalid` | Scrie o adresă de e-mail validă. | Enter a valid e-mail address. |
| `emailNeeded` | Adaugă un e-mail ca să continui de pe alt dispozitiv | Add an e-mail to continue on another device |
| `save` | Salvează ciorna | Save draft |
| `saved` | Ciorna e salvată | Draft saved |
| `linkSent` | Ți-am trimis un link pe e-mail ca să continui de pe orice dispozitiv | We e-mailed you a link to continue on any device |
| `linkAlready` | Linkul a fost deja trimis. Îl poți trimite din nou în {minutes} min. | The link was already sent. You can send it again in {minutes} min. |
| `offline` | Neconectat · salvăm când revii online | Offline · we save when you are back |
| `storageBlocked` | Browserul nu poate păstra ciorna. O păstrăm pe server după ce adaugi un e-mail. | Your browser cannot keep the draft. We keep it on the server once you add an e-mail. |
| `tooLarge` | Ciorna e prea mare ca să fie salvată pe server. | The draft is too large to save on the server. |
| `loading` | Se încarcă ciorna… | Loading the draft… |
| `invalidTitle` | Linkul nu mai e valid | The link is no longer valid |
| `invalidLine` | Linkul e greșit, vechi sau ciorna a fost ștearsă. | The link is wrong, old, or the draft was deleted. |
| `startAgain` | Începe din nou | Start again |
| `sentTitle` | Înscrierea a fost trimisă | The listing was sent |
| `sentLine` | Intră în cont ca să vezi service-ul. | Sign in to see your garage. |
| `signIn` | Intră în cont | Sign in |

Romanian diacritics with comma (ș, ț), never cedilla, as the catalogue check requires.

### Whole-page states (replace the form inside the frame)

- **invalid**: `<h1>` `invalidTitle`, `<p>` `invalidLine`, `<button hlmBtn>` `startAgain` → clears `draftId`/`token` from the browser copy, keeps its data, shows the empty-or-kept form.
- **sent**: `<h1>` `sentTitle`, `<p>` `sentLine`, `<button hlmBtn>` `signIn` → `SignInDialog.start()` (`apps/web/src/app/sign-in/sign-in-dialog.ts:30`).
- **loading** (link open, before the answer): `<p role="status">` `loading`; the server render shows ST-108's shell only (no draft is read on the server).

### Timing

- Browser copy: 1 000 ms after the last change; at once on the button.
- Server copy: at most every 5 000 ms while typing; on leaving a step (the current step changes); at once on the button; on `online`.
- Token removed from the address bar right after the `GET` answers (`replaceUrl`).

### Accessibility and layout (FR-019, 108-FR-011)

Field, button and notes at least 12 px, 44 px targets, no sideways scroll at 320 px, light and dark from Cockpit tokens, error and notes announced (`role="status"`/`aria-describedby`).

## E-mails (`libs/domain/src/notifications/templates/listing.ts`)

| Type | Subject RO / EN | Button | Reason line |
| --- | --- | --- | --- |
| `LISTING_CONTINUE_LINK` | Continuă înscrierea service-ului / Continue listing your garage | Continuă înscrierea / Continue listing → `link` | Primești acest e-mail pentru că ai început să înscrii un service pe MotorFix cu această adresă. Dacă nu ai fost tu, ignoră-l. / You get this e-mail because this address was given while listing a garage on MotorFix. If it was not you, ignore it. |
| `LISTING_REMINDER` | Ai început să-ți înscrii service-ul / You started listing your garage | Continuă de unde ai rămas / Pick up where you left off → `link` | the same |

Both e-mail only, `values: { link: 'link' }`, rendered in the draft's language; the reminder is held in quiet hours (not urgent), the link goes at any hour.

## Timers (`libs/domain/src/garages/listing-draft-sweep.ts`, a `DailyTask` run by the worker's daily job at 09:00 Europe/Bucharest)

- `remind(now)`: for each `open` draft with `reminded_at IS NULL` and `updated_at <= now − 3 days` — in one transaction: claim it (`UPDATE … WHERE reminded_at IS NULL RETURNING`), issue a `reminder = true` token, write the LISTING_REMINDER row; then queue the send with the link.
- `cleanUp(now)`: for each `open` draft with `updated_at <= now − 90 days` — delete every key in `data.files` through storage, then delete the draft (tokens and notification rows cascade).
- A second run the same day finds nothing to do; a failure in one draft is logged (draft id only) and the others continue.
