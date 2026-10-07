---
capability: garage-listing
updated: 2026-10-07
features:
  - 108-step-list-in-view
  - 040-garage-brand-stance
  - 114-save-draft
---

# Capability: Garage listing

How a garage owner lists a garage on MotorFix: the public "List your garage" page, its six steps and the step list that keeps the owner's place.

## Requirements

### 108-FR-001 — The web app MUST serve "List your garage" as a public page at `/ro/list-your-garage` and `/en/list-your-garage` (one address per language, the same path after the prefix, as every public page: `apps/web/src/app/app.routes.ts:46`), in the public frame, to anyone, signed in or not, with no permission or role check and no sign-in prompt.

_From 108-step-list-in-view._

### 108-FR-002 — The page MUST show, in the current language, the small label "PENTRU SERVICE-URI" / "FOR GARAGES", the heading "Pune-ți service-ul pe hartă" / "Put your garage on the map" and the introduction "Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui." / its English equivalent, never promising phone calls.

_From 108-step-list-in-view._

### 108-FR-003 — The page MUST hold six sections on one long page, in order, each with a numbered heading: 1 Service-ul / The garage, 2 Mărci / Brands, 3 Prețuri / Prices, 4 Mecanici / Mechanics marked "opțional" / "optional", 5 Fotografii și adresă / Photos and place, 6 Verificare / Verification marked "obligatoriu" / "required". Each section's body is empty in this story and offers a place for its story's content.

_From 108-step-list-in-view._

### 108-FR-004 — The page MUST show a step list titled "Pași" / "Steps", one `nav` landmark named by that title, listing the six steps with their number, label and optional/required mark. There is one list in the page, laid out beside the sections or under the phone bar by the 768 px breakpoint, never two copies.

_From 108-step-list-in-view._

### 108-FR-005 — Exactly one entry of the list MUST be the current step at any time, carrying `aria-current="step"` and a visible highlight: the last step whose heading has reached the bottom edge of the header (or the phone bar), step 1 before any has, and step 6 once the page is scrolled to its end.

_From 108-step-list-in-view._

### 108-FR-006 — Tapping or activating an entry with the keyboard MUST bring that step's section into view below the header (or the phone bar), move keyboard focus to the section's heading, and make that entry the current one, which it stays until the owner next scrolls (the jump's own scrolling never moves the highlight off it). With the device set to reduced motion the jump MUST be immediate.

_From 108-step-list-in-view._

### 108-FR-007 — At 768 px and wider the list MUST stay in view beside the sections while the page scrolls.

_From 108-step-list-in-view._

### 108-FR-008 — Narrower than 768 px the list MUST be a bar pinned under the header showing the current step as "<n> / 6 · <label>"; the page's header scrolls away, so the bar sticks to the top of the viewport once it is out of sight; the bar is a button with `aria-expanded` that opens the six steps under it (a disclosure: no focus trap); tapping a step jumps to it (FR-006) and closes the list; tapping outside or Escape closes it without a jump, Escape returning focus to the bar.

_From 108-step-list-in-view._

### 108-FR-009 — Switching the language MUST change every text of the page and the list, keep the same step current and keep any input in the sections: the page is not reloaded or rebuilt by the switch.

_From 108-step-list-in-view._

### 108-FR-010 — The list MUST show no completion tick in this story: what makes a step complete, and its tick, belong to the validation story.

_From 108-step-list-in-view._

### 108-FR-011 — The page MUST obey the phone layout rules: no sideways scroll at 320 px, 44 px targets for the bar and the entries, no text under 12 px, light and dark theme following the device. In both themes the current step differs from the others by more than colour (weight or a marker) and its highlight and the keyboard focus ring reach a 3:1 contrast against their background, text 4.5:1 (Cockpit tokens).

_From 108-step-list-in-view._

### 114-FR-018 — Nothing MUST be written to the audit history and no event MUST be emitted through the outbox while there is no account; the link e-mails go straight to the notifications queue. Logs MUST carry no e-mail address and no token (421-FR-010).

_From 114-save-draft._

### 114-FR-001 — Step 1 of the form MUST hold an e-mail field: required for a server copy, one address, trimmed, at most 254 characters, with text, "@" and a domain with a dot (the sign-up rule, 080-FR-005); it is not confirmed at this stage. An invalid address MUST be named in the field and MUST create no server copy and send no e-mail.

_From 114-save-draft._

### 114-FR-002 — The form MUST keep a browser copy of the draft: every value the form holds (one section per step plus the survey answers, photos as file keys) and the current step, saved 1 second after the last change and at once on "Salvează ciorna", and MUST restore it, at that step, when the page is opened again in the same browser. The fields of the other stories join the same store as they arrive.

_From 114-save-draft._

### 114-FR-003 — When the browser cannot store (storage blocked or throwing) the form MUST keep working and show a note that the draft is kept only on the server once an e-mail is given; no error is thrown to the owner.

_From 114-save-draft._

### 114-FR-004 — The page MUST show a button "Salvează ciorna" / "Save draft" on List your garage and its phone layout. Without an e-mail it saves the browser copy and highlights the e-mail field with "Adaugă un e-mail ca să continui de pe alt dispozitiv"; with a server copy it saves to the server at once, shows "Ciorna e salvată" and sends the link again (FR-008).

_From 114-save-draft._

### 114-FR-005 — When a valid e-mail is entered on step 1 and the field is left, the form MUST create the server copy (`POST /api/v1/listing-drafts`: e-mail, data, step, language) and send the continue link; from then on it MUST save the server copy (`PATCH /api/v1/listing-drafts/{id}`) at most every 5 seconds while the owner types, when the owner leaves a step, and at once on "Salvează ciorna". Every server save MUST carry the whole data, so the last save wins.

_From 114-save-draft._

### 114-FR-006 — The server copy MUST be the listing draft: id, e-mail, data (at most 256 KB, else 413 with a stable code), step, language, status (`open` or `submitted`), the hashes of its continue-link tokens, `reminded_at`, `created_at`, `updated_at`. It MUST hold no account and no garage: nothing is written to the garage tables until the listing is sent, by another story. Server copies MUST never be listed, searched or looked up by e-mail by any endpoint.

_From 114-save-draft._

### 114-FR-007 — Whoever holds the draft MUST be able to read and save it, and nobody else: the endpoints are public (no session) and take the token in the `X-Listing-Token` header; `GET /api/v1/listing-drafts/current` resolves the draft from the token alone (the token hash is unique) and answers its id with the draft; a request whose token hash matches none of the draft's tokens, a token of a deleted draft and a token for another draft id MUST answer 404 with the same body, and a request without the header 404 too. Only token hashes are stored, never a token.

_From 114-save-draft._

### 114-FR-008 — Sending the link (`POST /api/v1/listing-drafts/{id}/continue-link`, also called by FR-005's create and by FR-004) MUST make a new token of 32 random bytes, store its hash beside the draft's earlier ones, which stay valid until the draft is sent or its e-mail changes, and queue one LISTING_CONTINUE_LINK e-mail to the draft's e-mail, in the draft's language, subject "Continuă înscrierea service-ului" / "Continue listing your garage", whose link is `<PUBLIC_WEB_URL>/<lang>/list-your-garage?draft=<token>` and carries nothing else. The form MUST then say "Ți-am trimis un link pe e-mail ca să continui de pe orice dispozitiv".

_From 114-save-draft._

### 114-FR-009 — At most 5 link e-mails MUST go per draft per hour (reminders not counted); past the cap the save succeeds and the send answers 429 with a stable code and the seconds until the next send, which the form shows as "the link was already sent" with that time. The cap MUST be counted in PostgreSQL (the sent times of the draft's tokens), never in Redis alone.

_From 114-save-draft._

### 114-FR-011 — Opening the page with `?draft=<token>` MUST read the server copy (`GET /api/v1/listing-drafts/current` with the header; the link carries the token only), take it over whatever the browser held for the form, open the form at the saved step (as a jump, 108-FR-006) and keep the token with the browser copy so later saves reach the same server copy. The token MUST NOT stay in the address bar after the page has read it.

_From 114-save-draft._

### 114-FR-012 — A link whose token answers 404 MUST show "Linkul nu mai e valid" / "The link is no longer valid" with a button "Începe din nou" / "Start again" that opens an empty form; a link to a `submitted` draft MUST show "Înscrierea a fost trimisă" / "The listing was sent" with a sign-in button (the sign-in dialog of the public frame). A `submitted` draft MUST refuse every save with 409 and a stable code.

_From 114-save-draft._

### 114-FR-013 — Of two saves the later `updated_at` wins; a device MUST show the server copy at its next load unless its browser copy is marked as holding changes not yet on the server, in which case it shows its own copy and saves it to the server at once (FR-014), and the device that opened a link MUST replace its own copy with the server's (FR-011). The server MUST never merge fields.

_From 114-save-draft._

### 114-FR-014 — While the device is offline or the server save fails, the browser copy MUST stay, marked as holding changes not yet on the server until a server save succeeds, a line "Neconectat · salvăm când revii online" / "Offline · we save when you are back" MUST show while offline, and the next save (on the next change, on reconnect, or on "Salvează ciorna") MUST send the whole draft again. No change is lost between the two.

_From 114-save-draft._

### 114-FR-015 — A daily timer MUST send one LISTING_REMINDER e-mail, with a continue link as FR-008 makes it (outside the FR-009 count), to every draft with status `open`, `reminded_at` empty and `updated_at` 3 days old or more, and set `reminded_at` in the same transaction; a draft already reminded or `submitted` gets none (every server copy has an e-mail, FR-006), and a second run on the same day sends nothing twice.

_From 114-save-draft._

### 114-FR-016 — A daily timer MUST delete every draft with status `open` whose `updated_at` is 90 days old or more, with every file whose key its data holds (the storage delete); a draft changed since or `submitted` is kept. The 90 days are the brief's proposed retention, to be confirmed by the lawyer: the number MUST live in one place.

_From 114-save-draft._

### 114-FR-017 — The draft's language MUST be the form's language at the last save, and every e-mail MUST be written in the draft's language with the Romanian and English templates of the message-templates story; the link MUST open the page in that language.

_From 114-save-draft._

### 114-FR-019 — The e-mail field, the button, the notes and the error pages MUST obey the phone layout rules of the page (108-FR-011): no sideways scroll at 320 px, 44 px targets, text at least 12 px, light and dark, Romanian and English, and the field's error and the link-sent line MUST be announced to assistive technology (an `aria-live` region or a described-by error).

_From 114-save-draft._

### 114-FR-020 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the token stored hashed and found by hash, a bad, foreign or missing token answering 404; the link e-mail queued once per send, in the draft's language, and the 6th send in an hour answering 429 while the save succeeds; the last save winning by `updated_at`; a `submitted` draft refusing saves with 409; the reminder sent once and never twice; the clean-up deleting drafts 90 days old with their files and keeping the rest; the 256 KB limit; the creation throttle (11th create in an hour answering 429, nothing created) and `Cache-Control: no-store` on draft responses. A Playwright end-to-end test MUST fill step 1 with an e-mail, read the link from the test mail sink, open it in a new browser context and check the data is there, then reload the first context and check the data is still there.

_From 114-save-draft._

### 114-FR-021 — Abuse and leakage limits. Creating a server copy (`POST /api/v1/listing-drafts`) MUST be limited per source address by a Redis counter (the API has no throttle to reuse; 10 per hour; past it 429 with a stable code, nothing created and no e-mail sent), because the 5-per-draft cap (FR-009) alone lets one caller mail any address through many drafts. Every response that carries a draft or a token MUST send `Cache-Control: no-store`, and the page opened with `?draft=` MUST send `Referrer-Policy: no-referrer` so the token reaches no third party. Token lookup is by hash equality in PostgreSQL, never a comparison of clear tokens.

_From 114-save-draft._

### 040-FR-001 — Step 2 "Mărci" of "List your garage" MUST show, in the page's language, the hint on the three taps ("O apăsare: led verde, lucrezi pe ea. Încă una: led roșu, nu o primești. A treia o stinge." / "Tap once: green lamp, you work on it. Again: red lamp, you do not take it. A third tap switches it off."), a brand search field, one chip per popular brand (the twelve highest-ranked active brands of the catalogue) and the counter, in that order, in both languages.

_From 040-garage-brand-stance._

### 040-FR-002 — Each brand chip MUST be a button with `aria-pressed` that cycles off → taken (green, "lucrezi pe ea" / "you work on it") → refused (red, "nu o primești" / "you do not take it") → off on each tap, the state told by text as well as colour, and the button's accessible name carrying the brand and its current state text (`aria-pressed` is `true` for taken and refused alike, the text telling them apart).

_From 040-garage-brand-stance._

### 040-FR-003 — The counter MUST read the number of taken and the number of refused brands as "<n> primite · <m> refuzate" (singular "primită" / "refuzată"; "taken" / "refused" in English), counting only marked brands, and MUST update on every tap, announced politely to assistive technology (a live region).

_From 040-garage-brand-stance._

### 040-FR-004 — The search field MUST offer active brands from the catalogue matching the typed text (ignoring accents and case, through the catalogue's public search), and choosing one MUST mark it taken, as a chip if it was not one; a brand already a chip is marked in place, never added twice. Results are buttons reachable by keyboard; text with no match shows a line saying no brand was found, and an empty field shows no results. When the search fails the chips MUST keep working and a line MUST say that search is not working right now.

_From 040-garage-brand-stance._

### 040-FR-005 — The step MUST offer two optional texts: a brand note of at most 140 characters and a refusal phrase of at most 60 characters (counted as code points, after trimming surrounding whitespace, in the step and on the write alike), each with a label and its limit shown, refusing text over the limit; a blank text is no text.

_From 040-garage-brand-stance._

### 040-FR-006 — The step's values MUST be the `brands` section of the listing draft (stored as the draft's step 2, `steps['2']` in ST-114's shape): the marked brands by id with their stance, the note and the phrase; a brand switched off is absent. They are kept with the rest of the form and restored with it; nothing is written to the garage's tables from the form until the listing is sent (the sending story writes the rows through the same function as FR-008).

_From 040-garage-brand-stance._

### 040-FR-007 — Switching the language MUST change every text of the step and keep every chip's state and both texts.

_From 040-garage-brand-stance._

### 040-FR-013 — The step and every text it shows MUST obey the phone layout rules: no sideways scroll at 320 px, 44 px tap targets for the chips, no text under 12 px, light and dark theme following the device, chip states told by more than colour with a 3:1 contrast of the lamp and the focus ring and 4.5:1 for text.

_From 040-garage-brand-stance._

## Retired

- `108-FR-012` — superseded by `114-FR-018` (2026-10-07)
