---
capability: garage-listing
updated: 2026-10-08
features:
  - 108-step-list-in-view
  - 040-garage-brand-stance
  - 114-save-draft
  - 205-company-rar-check
  - 112-opening-hours
  - 354-job-catalogue-prices
  - 109-garage-details-prices
  - 861-jump-holds-step
  - 110-workshop-photos
  - 885-restored-draft-check
  - 111-garage-address-map
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

### 861-FR-008 — Replacing 108-FR-006: tapping or activating an entry with the keyboard MUST bring that step's section into view below the header (or the phone bar), move keyboard focus to the section's heading, and make that entry the current one; the jump's own scrolling, from its first movement to its end, never moves the highlight off it (FR-001), and the owner's next scroll after the jump has ended is followed (FR-002). With the device set to reduced motion the jump MUST be immediate.

_From 861-jump-holds-step._

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

### 885-FR-003 — Replacing 114-FR-002: the form MUST keep a browser copy of the draft: every value the form holds (one section per step plus the survey answers, photos as file keys) and the current step, saved 1 second after the last change and at once on "Salvează ciorna", and MUST restore it, at that step, when the page is opened again in the same browser, provided its data passes the shared draft-data rule (FR-001; a copy that fails it is handled by FR-002). A restored copy is pushed to the server when marked dirty and the server copy fetched when it holds a token and no unsaved changes, exactly as today (114-FR-011, 114-FR-013). The fields of the other stories join the same store as they arrive.

_From 885-restored-draft-check._

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

### 110-FR-003 — Deleting a photo key MUST also delete the keys derived from it (its thumbnail and display copy), in one storage call, and succeed when any of them holds no object (422-FR-008); the storage rules for the `garage_photo` purpose stay JPEG, PNG and WebP with their signature check (422-FR-001, 422-FR-005), so a file whose bytes are not a photo is deleted and refused with `file_type_mismatch`. HEIC is not accepted: the worker's image library cannot decode it on the runtime image (`deferred.md`).

_From 110-workshop-photos._

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

### 205-FR-001 — Step 6 of List your garage (the section headed "6 Verificare · obligatoriu" / "6 Verification · required", 108-FR-003) MUST open with the intro "Publicăm doar service-uri care funcționează legal în România. Verificăm firma și autorizația RAR înainte ca profilul să apară pe hartă." / "We only publish garages that operate legally in Romania. We check the company and the RAR authorisation before the profile appears on the map."

_From 205-company-rar-check._

### 205-FR-002 — The step MUST hold a field labelled "CUI-ul firmei" / "Company tax ID" that accepts an optional "RO" prefix in any letter case, spaces anywhere, and 2 to 10 digits whose last digit is the control digit (key 753217532: each of the first digits, right-aligned to nine places, times the key's digit in that place, summed, times 10, modulo 11, with 10 read as 0). When the owner leaves the field holding a value that fails the rule, the error "CUI invalid" / "Invalid tax ID" MUST show under the field and the CUI MUST NOT count as done; a value that passes counts as done. Whatever the control digit says, the draft keeps the stripped form (digits and any other characters typed, without the "RO" prefix and without spaces); an empty field removes the key. The field shows what was typed until the owner leaves it, then shows the stripped form, so the field after leaving equals the field after a restore. An empty field shows no error and is not done. The field takes no more than 40 characters as typed, spaces included; "RO" alone strips to empty and is treated as an empty field.

_From 205-company-rar-check._

### 205-FR-003 — The CUI rule MUST be one function in the contracts library, used by the form and available unchanged to the submission (ST-116) and the admin's company check (ST-203); no second copy of the rule may exist. It MUST answer the brief's examples: "RO18547290" and "18547290" valid, "RO 18547291" invalid.

_From 205-company-rar-check._

### 205-FR-004 — The step MUST hold a field labelled "Numărul autorizației tehnice RAR" / "RAR technical authorisation number" with the hint "de pe autorizația afișată în atelier" / "from the authorisation displayed in the workshop". Its value is trimmed first, then put in capitals and cut to 40 characters (the field takes no more); inner characters are kept as typed; the 3-character rule counts the trimmed value; the field shows the stored form once the owner leaves it; an empty value removes the key; 3 characters or more count as done; 1 or 2 show "Cel puțin 3 caractere" / "At least 3 characters" under the field and are not done; empty shows nothing and is not done. The format is checked no further: the admin checks the number in the register by hand (ST-204).

_From 205-company-rar-check._

### 205-FR-005 — The step MUST show a counter "{n} din 5 completate" / "{n} of 5 completed" over five items: the CUI, the RAR number, the ONRC certificate, the RAR authorisation and the declaration. This story counts the first two; the other three count 0 until the uploads-and-declaration story (ST-206) supplies them, so the counter reads 0, 1 or 2 here. The counter is one function of five yes/no values, and its change MUST be announced to assistive technology (a polite live region).

_From 205-company-rar-check._

### 205-FR-006 — Under the fields the step MUST show the note "Comparăm datele firmei cu registrele publice (ANAF, ONRC, RAR). Documentele le vede doar echipa MotorFix." / "We compare the company details with the public registers (ANAF, ONRC, RAR). Only the MotorFix team sees the documents."

_From 205-company-rar-check._

### 205-FR-007 — The step MUST show no look-up: no "Verifică firma" / "Check company" or "Caută în registrul RAR" / "Look up in the RAR register" button, no company name, CAEN code, activity list or "not covered" warning, and no call to any register. No release flag is built for them: the automatic look-ups are a later story with no page yet, which adds the buttons when it exists.

_From 205-company-rar-check._

### 205-FR-008 — The two values MUST live in the draft's step-6 section (the one-section-per-step envelope the draft already has, `data.steps["6"]`) under the keys `cui` (the stored digits) and `rarNumber` (the trimmed capitals), in the browser copy and the server copy exactly as the draft saves every other value (114-FR-002, 114-FR-005: one second after the last change in the browser, at most every 5 seconds on the server, whole every time). Opening the page again in the same browser, and opening the continue link on another device, MUST show both values and recompute done and the counter from them (114-FR-011). A server copy without a step-6 section MUST open with empty fields.

_From 205-company-rar-check._

### 205-FR-009 — The server MUST check the draft's step-6 section on every create and save: it may hold only `cui` and `rarNumber`, each a string of at most 40 characters or absent; any other key, type or length MUST be refused with 400 and the draft's stable validation code, as the envelope is refused today. The server MUST NOT refuse a CUI that fails the control-digit rule or a RAR number under 3 characters: a draft keeps what the owner typed, and the sending story re-checks both when the listing is sent.

_From 205-company-rar-check._

### 205-FR-010 — Field errors MUST show under their field, in the person's language, once the owner has left the field (not while first typing in it) and on a restored value that fails; after that the error follows the value as it changes. The done state and the counter follow the value on every change, typed or not left yet. The error text sits in a polite live region so its appearance is announced; the field MUST carry `aria-invalid` and be described by its error or, when there is none, by its hint. Leaving the field clear removes the error.

_From 205-company-rar-check._

### 205-FR-011 — The step MUST write nothing to the garage tables, the audit history or the outbox, and MUST notify nobody (114-FR-018): the CUI and the RAR number reach `GARAGE.cui` and `VERIFICATION_FILE.rar_number` only when the listing is sent, by the sending story (ST-116), which adds those fields; this story adds no column.

_From 205-company-rar-check._

### 205-FR-012 — Every text of the step MUST exist in Romanian and English in the public interface texts and follow the interface language; switching the language MUST change the texts and keep the values, the done state and the counter's number (108-FR-009).

_From 205-company-rar-check._

### 205-FR-013 — The step MUST obey the page's phone layout rules (108-FR-011): no sideways scroll at 320 px, 44 px targets, no text under 12 px, light and dark theme following the device; the error text MUST reach a 4.5:1 contrast against its background in both themes.

_From 205-company-rar-check._

### 205-FR-014 — Tests MUST cover, in Jest: the CUI rule (valid with and without "RO", with spaces and a lower-case prefix, a wrong control digit, too short, too long, a letter in the digits); the RAR number rule (trim, capitals, 2 and 3 characters, 40 and 41); the counter for 0 to 5 done items; on real PostgreSQL, a draft saved with both step-6 values and read back unchanged, a section with an unknown key, a non-string or a 41-character string refused with 400 while a save without the section is accepted. A Playwright end-to-end test MUST, at a phone width, open step 6, type an invalid CUI and see the error, type a valid one and a RAR number and see the counter reach "2 din 5 completate", and check that no look-up button exists.

_From 205-company-rar-check._

### 112-FR-001 — Step 5 of "List your garage" MUST show, in the page's language, a block "Program" / "Opening hours" with a row "Luni – vineri" / "Monday to Friday" and a row "Sâmbătă" / "Saturday", each with an opening and a closing time in 15-minute steps, the Saturday row also with a "Închis" / "Closed" tick that empties it (the Monday-to-Friday row has none: a weekday is closed in the per-day view), offering Monday to Friday 08:00–17:00 and Saturday closed as the starting point; the starting point is shown, not kept, until the owner changes a value, after which the whole weekly set is kept.

_From 112-opening-hours._

### 112-FR-002 — The block MUST offer a disclosure "Program pe zile" / "Hours by day" opening one row per day, Monday to Sunday, each with its own times, a closed tick and "Adaugă pauză" / "Add a break" that splits the day into two intervals (first interval, break, second interval); Sunday starts closed. The simple rows MUST reflect the per-day values: the Monday-to-Friday row shows the common interval when all five weekdays hold one equal interval, else it reads "Program diferit pe zile" / "Different hours by day" as text, with no time fields, and the disclosure open; while it shows its fields, editing the simple row sets all five weekdays to that one interval.

_From 112-opening-hours._

### 112-FR-003 — Weekly hours MUST be, for each of the seven days, a list of zero to two intervals of "HH:MM" times on the 15-minute grid (00:00 to 23:45), each closing after its opening, in order and not overlapping (touching is allowed); a day with no interval is closed. Every rule MUST be checked in the step (the invalid value is not kept, the row shows "Ora de închidere trebuie să fie după deschidere" / "Closing must be after opening" or the break's line, and the step is incomplete) and again by the draft's save and the write of FR-009, which refuse a section that breaks one (bad request; the draft save answers 400 as for step 6). An invalid value is never kept, so after a reload the row shows the last valid value and the step is complete again.

_From 112-opening-hours._

### 112-FR-004 — Under the hours the step MUST show "Zile închise" / "Closed days": a date field, an optional note of at most 80 characters (code points, trimmed, blank as none) with its limit shown, an add button, and the list of added days with their note and a remove button each. A day MUST be from today (Europe/Bucharest) to two years ahead, not already in the list and not a legal holiday; a refused day shows its reason ("E deja zi liberă legală" / "Already a legal holiday", "Data a trecut" / "The date has passed", "Cel mult 2 ani înainte" / "At most 2 years ahead") and adds nothing.

_From 112-opening-hours._

### 112-FR-005 — The step MUST say, under the closed days, that Romania's legal holidays count as closed by themselves and need no entry, and list the next six legal holidays with their names from the public-holiday calendar (`GET /api/v1/public-holidays`, public, by year, 15 items at most for the two seeded years), in the page's language. A year outside 2000 to 2100 or a missing year is refused with 400 and a year with no rows answers an empty list (contracts/public-holidays.md). When the calendar cannot be read the line says the list is not available right now and the holiday check of FR-004 is skipped; nothing else in the step waits for it.

_From 112-opening-hours._

### 112-FR-006 — The step MUST show "Facilități pentru clienți" / "Facilities for customers" with three toggle chips, "Mașină la schimb" / "Courtesy car", "Preluare și predare" / "Pick-up and drop-off", "Sală de așteptare" / "Waiting area" (`courtesy_car`, `pickup_dropoff`, `waiting_area`), each a button with `aria-pressed`, the state told by text or shape as well as colour, and the hint "Șoferii pot filtra după ele. Bifează doar ce oferi mereu, nu „uneori”." / "Drivers can filter by these. Tick only what you always offer, not \"sometimes\"." under them; a ticked courtesy car leaves a place under its chip for ST-397's choice and adds nothing else.

_From 112-opening-hours._

### 112-FR-007 — The step's values MUST be this story's keys of the draft's step 5 section (`steps['5']`, ST-114's shape): `hours` (seven days to intervals), `closedDays` (date and optional note), `facilities` (the ticked keys), typed in the shared contracts library and checked on save like step 6's section (an unknown facility, a malformed time or date, a third interval or an 81-character note is refused with 400; a section without these keys, or with other stories' keys beside them, is accepted). They are kept with the rest of the form, restored with it on reload and through the continue link, and MUST write nothing to the garage tables, the audit history or the outbox while there is no account (114-FR-018).

_From 112-opening-hours._

### 112-FR-009 — The system MUST own one function that writes a garage's hours, closed days and facilities from the section, for the submit story to run inside its transaction: it sets the garage's weekly hours (the starting point of FR-001 when the section has no `hours`), replaces the garage's closed-day rows with one per own closed day that FR-010 keeps (date, note), and replaces its facility rows with one per ticked facility with status `listed`; a section that breaks a rule of FR-003, FR-004 or FR-006 is refused whole (a day outside FR-004's window is dropped by FR-010 instead, since a kept draft ages) and nothing is written. No route calls it in this story; it is tested on a real database.

_From 112-opening-hours._

### 112-FR-010 — The write MUST NOT store a closed day that is before today (Europe/Bucharest), after the last day of FR-004's two-year window, or a legal holiday held in the calendar: a legal holiday is closed through the calendar alone, never through a closed-day row. Whether a garage is open at a given moment is ST-309's status function, which reads the hours, the closed-day rows and the calendar this story writes; this story adds no such function.

_From 112-opening-hours._

### 112-FR-011 — Every text of the step MUST exist in Romanian and English in the public interface texts and follow the interface language (108-FR-009); switching the language MUST change the texts and keep every time, closed day and tick. Day names and dates MUST be shown as the locale formats them.

_From 112-opening-hours._

### 112-FR-012 — The step MUST obey the page's phone layout rules (108-FR-011, `phone-layout.md`): no sideways scroll at 320 px with the two times side by side on a row or stacked when they do not fit, 44 px targets for the ticks, chips, add and remove buttons, no text under 12 px, time and date fields at 16 px, light and dark theme following the device; a row's error MUST be tied to its fields (`aria-describedby`) and announced, and the chips' states MUST be readable by assistive technology.

_From 112-opening-hours._

### 112-FR-013 — Tests MUST cover, in Jest: the interval rules (order, overlap, touching accepted, at most two, 15-minute grid, closing after opening, a break inside the day), the closed-day rules (today to two years, duplicate, legal holiday, 80-character note), the simple-rows view over per-day values; on real PostgreSQL: a draft saved with the three keys and read back unchanged, a bad time, a third interval, an unknown facility and an 81-character note refused with 400 while a section without the keys is accepted; the write creating the hours, the closed-day rows and facility rows with status `listed` and refusing a bad section whole; a legal holiday and a past date in the section written as no closed-day row, and a section without `hours` written as the starting point; the calendar holding 16 days for 2026 and 17 for 2027, each once. A Playwright end-to-end test MUST, at a phone width, set Monday with a lunch break, open Sunday, add a closed day with a note, tick two facilities, reload and check everything is back.

_From 112-opening-hours._

### 354-FR-003 — Each garage MUST be able to carry an hourly labour range, `labour_from_bani` and `labour_to_bani`, both empty until the listing is sent and both set afterwards.

_From 354-job-catalogue-prices._

### 354-FR-004 — Each garage MUST be able to carry price rows, one per garage, job and brand, where an absent brand is the default range and counts as one brand (`(garage_id, job_type_id, brand_id)` unique with empty brands equal, PostgreSQL `NULLS NOT DISTINCT`); a row holds `from_bani`, optional `to_bani`, optional `duration_minutes`, `visible` (true unless the garage hides it), `position` (the order the garage entered the jobs, 0-based, used by the public list), `updated_at` and `updated_by` (the account that last saved it). The job MUST be a catalogue job and the brand, when given, a catalogue brand, both enforced by the database.

_From 354-job-catalogue-prices._

### 354-FR-005 — Money MUST be stored and carried by the API as integer bani; the screens take and show whole lei. One conversion (lei ↔ bani) MUST exist where the API and the web app both read it; it refuses a lei value that is not a whole number. The API itself accepts any integer number of bani (A29).

_From 354-job-catalogue-prices._

### 354-FR-006 — One range check MUST exist where the API and the web app both read it, and every route that saves a range (the listing submit, the draft's step 3, the later editor) MUST use it; no second copy of the rule may exist. It takes a range (from, optional to, optional duration) and returns field errors with stable codes (the code table is in `data-model.md`, "Shared rules") and warnings: `from` and `to` integer bani; `from` at least 1 leu (100 bani); `to`, when set, at least `from` and at most 100.000 lei (10.000.000 bani); `from` at most 100.000 lei; `duration`, when set, from 15 to 4.800 minutes in steps of 15; the warning `wide_range` when `to` is set and more than 3 × `from` (exactly 3 × is not wide). The ratio 3 MUST live in one named place. A warning never refuses a save.

_From 354-job-catalogue-prices._

### 354-FR-007 — A range refused by the check MUST be answered 422 by the API with the field errors (field path and code), and nothing of that save stored; a saved range with warnings MUST return them to the caller so the response can carry them.

_From 354-job-catalogue-prices._

### 109-FR-015 — (Replaces 354-FR-008.) The `garages` module MUST provide one write that saves a garage's starting prices inside a transaction the caller owns (the existing one, `libs/domain/src/garages/prices/garage-prices.service.ts:67`, extended, never a second), taking the garage, the actor (the owner account created in that transaction) and the step-3 payload: the labour range (both ends required: a missing end, start or top, is refused with code `required` before the range check runs; the range check, `wide_range` included, applies to it) and the flat list of FR-010, each entry with either a catalogue job id or a proposed job name (2–80 characters), an optional brand id, from and optional to. The job's duration is not taken here (it is set in the price list editor, MF-57); the stored row's `duration_minutes` stays empty. For each proposed job, in the same transaction and before its price rows, it MUST create a catalogue job with `status = pending`, `name_ro` and `name_en` both the typed name, a unique key derived from the name (as the slug of FR-013) and `proposed_by_garage_id` the garage. It MUST write the labour range on the garage and one price row per job in payload order with `visible = true`, `position` 0, 1, 2…, `updated_at` now and `updated_by` the actor; a job with no top is stored with `to_bani` empty and `visible = true` (the public rule, ST-357, hides it on read; no "hidden" mark is stored).

_From 109-garage-details-prices._

### 109-FR-016 — (Replaces 354-FR-009.) The write MUST check every range with 354-FR-006 and refuse the whole payload, each refusal a field error naming the row, on: any range error; more than 50 entries without a brand or more than 500 entries in all (`too_many` on `jobs`); the duplicate `(job, brand)` pair within the payload; a brand range whose job has no default range in the payload; an unknown job; a job that is not `approved` unless it is proposed in this payload; an unknown brand; a brand the garage does not take (no `works_on` garage-brand row at save time, `not_taken` on `brandId`, so the sending story saves the brands before the prices); a proposed job name shorter than 2 or longer than 80 characters after trimming (`length` on `name`) or repeated within the payload, accents and case ignored (`duplicate` on `name`). A database refusal on the price unique index (two saves racing for one garage) MUST be answered as the same 422 refusal with `duplicate` on the row, never as a server error. It MUST write nothing when it refuses, and because it runs in the caller's transaction, a caller that fails afterwards MUST leave no price row, labour range, proposed job, event or audit entry behind, the listing draft untouched.

_From 109-garage-details-prices._

### 109-FR-017 — (Replaces 354-FR-010.) In the same transaction the write MUST record the starting values once in the audit history through the existing audit writer: one `create` entry per price row (subject type `garage_price`, the row's values as the new value, the garage id as scope), one `update` entry per labour field on the garage from null to the value (subject type `garage`, fields `labour_from_bani`, `labour_to_bani`, through `recordChanges`) and one `create` entry per proposed job (subject type `job_type`), actor the owner. It MUST write one `catalogue_job.proposed` outbox event per proposed job (subject the job id, payload the garage id and the job id, audience the admins as the notification catalogue reads it) and no other event, and notify nobody else: the garage is not public yet. The event's notification (ADMIN_CATALOGUE_JOB_PENDING) is already wired (`libs/domain/src/notifications/catalogue.ts:46`); nothing else of the approval is built here.

_From 109-garage-details-prices._

### 354-FR-011 — The write MUST return the saved rows and the warnings per row and for the labour range, so the sending story's response can carry `wide_range` where it applies.

_From 354-job-catalogue-prices._

### 354-FR-012 — Tests MUST cover, in Jest on real PostgreSQL: the load is idempotent and atomic; lei ↔ bani; the range check's table (top below bottom refused, empty top allowed, the 1 leu and 100.000 lei bounds, the duration steps, the 3 × warning and the exactly-3 × non-warning); the unique rule with an empty brand at the database; the write creating the garage's labour range, the rows and the audit entries in one transaction; a refused payload storing nothing; a failed caller transaction leaving nothing. The end-to-end check of step 3 through submit to the price API belongs to the stories that build those (ST-109, the sending story, ST-357) and is recorded here as deferred.

_From 354-job-catalogue-prices._

### 109-FR-001 — Step 1 of the form MUST hold, after the e-mail field (114-FR-001), the garage name (required, 2–80 characters), the phone (required), "La ce sunteți cei mai buni" / "What you are best at" (required, 1–160 characters) with the brief's hint, and the kind of business (required) as four choices: company (`company`), PFA (`pfa`), II (`ii`), mobile mechanic (`mobile`). When `mobile` is chosen a second required choice appears, PFA or company (`pfa`, `company`); choosing another kind hides and clears it. Every label, hint and error exists in Romanian and English.

_From 109-garage-details-prices._

### 109-FR-002 — The phone MUST be checked as the owner leaves the field with the shared normaliser (`libs/contracts/src/phone.ts:6`): a result that is not `+40` followed by nine digits shows "Momentan acceptăm doar numere din România" / "We only take Romanian numbers for now" and marks the field invalid (the error line waits for the owner to leave the field; completeness, FR-012, judges the normalised value on every change); the draft keeps the phone as typed; the normalised form is what the write stores.

_From 109-garage-details-prices._

### 109-FR-003 — The step-1 values MUST be kept in the draft as `steps['1']` (the browser copy and the server copy, 114-FR-002, 114-FR-005), restored from it on load, and checked by one guard where the API and the web app both read it (as `isStep6Section`, `libs/contracts/src/listing-verification.ts:39`): only the keys `name`, `phone`, `knownFor`, `businessKind`, `mobileLegalForm`, each a string of at most 160 UTF-16 code units, `businessKind` and `mobileLegalForm` among their allowed values when present; the draft envelope (`libs/contracts/src/listing-drafts.dto.ts:40`) MUST refuse a section that fails it, so the server never holds a malformed one.

_From 109-garage-details-prices._

### 109-FR-004 — Step 3 MUST show the labour range per hour (from and to, both required), the brief's hint, and three catalogue jobs already listed in the mock's order (diagnosis and fault-code read, oil and filter service, front brake pads and discs) with their names in the current language, each with a from–to range in whole lei. A row MAY be removed; step 3 is complete only when the labour range and every row's range are valid and at least one job row remains.

_From 109-garage-details-prices._

### 109-FR-005 — Every range the form takes MUST be judged by the one shared range check (354-FR-006, `libs/contracts/src/price-range.ts:59`) with the form holding bani: the field's lei are turned to bani with `leiToBani` and shown again with a `baniToLei` added beside it (the first reader the ST-354 deferral waited for). The error "Prețul minim trebuie să fie mai mic decât maximul" / "The low price must be below the high one" shows for `below_from`; the bounds errors show in words; the `wide_range` warning shows as a warning under the range and never makes the row incomplete. Price fields accept digits only and a pasted "1.200 lei" becomes 1200.

_From 109-garage-details-prices._

### 109-FR-007 — When no offered job fits, the owner MUST be able to add the typed text (2–80 characters) as a proposed job: a row with that name, its own range and the tag "Așteaptă aprobare" / "Awaiting approval". When the search fails or does not answer, the line "Căutarea nu merge acum" / "Search is not working right now" shows and the proposal stays possible.

_From 109-garage-details-prices._

### 109-FR-008 — For a job, the owner MUST be able to open "Interval diferit pentru o marcă" / "A different range for a brand" and add a brand range: the brands offered are those taken (`works_on`) in step 2 (`apps/web/src/app/public/brands-section.ts:11`) and not already given for that job; the brand row sits under the job's default row with its own range. A brand untaken in step 2 removes its brand rows from step 3 at once; the draft follows at the next save, and the write's `not_taken` check (FR-016) is the backstop.

_From 109-garage-details-prices._

### 109-FR-009 — Step 3 MUST hold at most 50 job rows (brand rows not counted): past 50, "Adaugă o lucrare" is disabled with "Cel mult 50 de lucrări" / "At most 50 jobs".

_From 109-garage-details-prices._

### 109-FR-010 — The step-3 values MUST be kept in the draft as `steps['3']`, restored on load and checked by one shared guard as FR-003: `labour` (`fromBani`, `toBani`, each an integer or absent) and `jobs`, one flat list as the write takes it (`libs/domain/src/garages/prices/garage-prices.service.ts:67`): each entry holds either a catalogue job id `jobTypeId` (uuid) or a proposed job `name` (string, at most 80), an optional `brandId` (uuid; an entry with a brand is that job's brand range), and `fromBani` and `toBani` (integer or absent). At most 50 entries without a brand and at most 500 entries in all. The shape is the write's input (FR-015) with a job name allowed in place of an id, so the sending story passes the section through without reshaping it; an empty end is kept absent, never as 0. When `steps['3']` is absent the form pre-lists the three jobs of FR-004, resolved by their catalogue keys from `GET /api/v1/job-types` (never hard-coded ids); once the section exists, `jobs: []` stays empty. When that lookup fails, no row is pre-listed, the line of FR-007 shows, and the lookup runs again the next time the step opens while `steps['3']` is still absent.

_From 109-garage-details-prices._

### 109-FR-011 — Step 4 MUST show the "OPȚIONAL" / "OPTIONAL" mark the page already carries, the switch "Afișează-i pe pagina ta" / "Show them on your page" (off by default), rows with "Nume" / "Name" (2–60 characters) and "Pe ce lucrează de obicei" / "What they mostly work on" (optional, at most 80 characters), the name's initials on the row, "Adaugă un mecanic" / "Add a mechanic" adding a row up to 30 (then disabled with "Cel mult 30 de mecanici" / "At most 30 mechanics"), and a way to remove a row. A row with a name shorter than 2 characters shows "Scrie numele mecanicului" / "Give the mechanic's name" and makes step 4 incomplete; an empty step 4 is complete. The values MUST be kept in the draft as `steps['4']` (`onProfile` boolean, `mechanics` of at most 30 `{ name, speciality? }` with the lengths above), restored on load and checked by one shared guard as FR-003.

_From 109-garage-details-prices._

### 109-FR-012 — Each of the three sections MUST expose whether it is complete by the rules above, through one pure function per section where the form and the sending story's checks both read it (texts judged after trimming, as the writes trim them), and the step list MUST show a tick on steps 1, 3 and 4 when their section is complete, updated as the owner types.

_From 109-garage-details-prices._

### 109-FR-013 — The `garages` module MUST provide one write that creates the garage from a step-1 section inside a transaction the caller owns, taking the transaction, the actor (the owner account created in it) and the section: it MUST trim the texts, check the lengths of FR-001 (code `length` on the field), normalise the phone and refuse one that is not `+40` and nine digits (code `romanian` on `phone`), require the kind of business and, for `mobile`, the legal form (code `required`), and create the garage with `status = draft`, `name`, a unique `slug` derived from the name (lower case, accents dropped, non-letters as hyphens, a numeric suffix when taken), `phone`, `known_for`, `business_kind`, `mobile_legal_form` (null unless mobile); a refusal is the 422 field-error refusal the other writes raise and writes nothing. It MUST record one `create` audit entry (subject type `garage`, the stored values as the new value, actor the owner) and emit no event. The garage row gains `phone`, `known_for`, `business_kind` (`company`, `pfa`, `ii`, `mobile`) and `mobile_legal_form` (`pfa`, `company`), all empty for garages that exist today.

_From 109-garage-details-prices._

### 109-FR-014 — The phone MUST never leave the server for a driver: the public garage profile and every public card keep selecting explicit fields and never the phone (`libs/domain/src/garages/public-garages.ts:24`), and a test MUST assert the public response carries no phone.

_From 109-garage-details-prices._

### 109-FR-018 — The `garages` module MUST provide one write that saves the step-4 section inside the caller's transaction, taking the transaction, the garage, the actor and the section: it checks the lengths of FR-011 (code `length` on the field) and the cap of 30 (`too_many` on `mechanics`), creates one mechanic card per row with `garage_id`, `name`, `speciality` (null when blank), `account_id` empty and `on_profile` the switch's value, and records one `create` audit entry per card (subject type `mechanic`, actor the owner). The mechanic row gains a nullable `account_id` (still unique when set), `name`, `speciality` and `on_profile` (default false); mechanics with an account keep working as today (their name comes from the account until the invite story decides otherwise).

_From 109-garage-details-prices._

### 109-FR-019 — An accountless mechanic card MUST reach no driver: the public profile shows no mechanics today and this story adds none; a test MUST assert the public response of a garage with cards carries no mechanic. Showing them, once invited and accepted, is the invite story's.

_From 109-garage-details-prices._

### 109-FR-020 — Tests MUST cover: in Jest, the three section guards (good sections, each wrong key, type and length), the three completeness functions, phone normalisation and refusal of a non-Romanian number, `baniToLei` and the lei-and-digits input rule, the job list's cap and removal, the brand-range offer following step 2; in Jest on real PostgreSQL, the garage write (row, slug uniqueness, refusals, audit, no phone on the public read), the prices write with a proposed job (pending job, price row, event, audit, all gone on rollback), the 50-job cap, the not-taken brand, the `required` labour start, the duplicate race answered 422, the mechanics write (cards, audit, none on the public read), and the public route list with `GET /api/v1/job-types`; in Playwright, fill steps 1, 3 (one brand range, one proposed job) and 4, reload the page and find everything back. The end-to-end check through the submit to the price API stays deferred to the sending story (ST-354 deferral).

_From 109-garage-details-prices._

### 861-FR-001 — A jump to a step, from a tap in the step list or from a draft's restore, MUST keep that step current from the moment of the jump until the jump's own scrolling has ended, however late that scrolling starts and however long it lasts; no scroll event of the jump's own flight changes the current step.

_From 861-jump-holds-step._

### 861-FR-002 — When the jump's scrolling has ended, the hold is released (the end itself does not re-read the spy) and the step list MUST follow the owner's scrolling again from the next scroll event, with the on-screen rule unchanged: a jumped-to step the page could not bring to the line stays current while its heading is on screen, and follows once the scroll reaches it or a later step or takes the heading off screen (108-FR-006).

_From 861-jump-holds-step._

### 861-FR-003 — A jump that moves the page by nothing (its target, the heading's page top minus its `scroll-margin-top` clamped to the page's scroll range, is within 1 px of the current scroll position) MUST make the step current at once and MUST NOT hold the step list against the owner's next scroll.

_From 861-jump-holds-step._

### 861-FR-004 — Where the browser signals the end of a scroll, the hold MUST end on that signal; where it does not, the hold MUST end after a short quiet time measured from the jump's last movement (never from the tap alone), so a late start is held as a prompt one is. A jump whose scroll has not started 3 s after the tap lets go (the page could not move after all), so the step list never stops following the owner; a scroll that has started is never cut short by it (amended at review, 2026-10-08).

_From 861-jump-holds-step._

### 861-FR-005 — The restore from a continue link (114-FR-011) MUST use the same jump and the same hold as a tap, so the page opens at the saved step whether it starts quickly or slowly.

_From 861-jump-holds-step._

### 861-FR-007 — No API, contract or stored-data change: the draft's saved step is written by the same path as today.

_From 861-jump-holds-step._

### 110-FR-001 — Step 5 of List your garage MUST show, in the page's language, a drop area reading "Trage aici fotografii cu atelierul, elevatoarele și echipa" / "Drop photos of the workshop, the lifts and the team here" with a button "Alege fotografii" / "Choose photos" that opens the device's picker limited to images (several at once). When the draft's step 1 kind of business is `mobile` the drop area MUST read "Trage aici fotografii cu duba sau trusa mobilă și sculele principale" / "Drop photos of your van or mobile kit and main tools here" instead; the wording follows the kind of business live, and the photos stay.

_From 110-workshop-photos._

### 110-FR-002 — Each photo MUST be JPEG, PNG or WebP and at most 10 MB; the draft MUST hold at most 20 photos. The form MUST refuse a file of another type or size before asking for an upload address with "Doar fotografii JPG, PNG sau WEBP, de cel mult 10 MB" / "Only JPG, PNG or WEBP photos, up to 10 MB", and a 21st photo with "Cel mult 20 de fotografii" / "At most 20 photos"; the other files of the same drop carry on. The server MUST refuse the same cases on its own (type and size through the storage rules, 422-FR-002 and 422-FR-005; the 21st against the draft's current photos, 422 with a stable code, checked when the upload address is asked for and again, binding, at confirm, which counts and appends in one update and deletes a refused object), so the limits live in one place shared by the form and the API.

_From 110-workshop-photos._

### 110-FR-004 — The browser MUST ask the API for a signed upload address for the draft (`POST /api/v1/listing-drafts/{id}/photos/upload-url`, the draft's token in `X-Listing-Token`, the declared type and size), send the file straight to the private store through the shared upload helper (progress, retries, one address renewal, 422-FR-012), and then confirm it (`POST /api/v1/listing-drafts/{id}/photos`, the key), which adds the photo at the end of the draft's photos and answers the photo. The API MUST never carry the file's bytes. The address is signed for the storage module's lifetime (15 minutes, 422-FR-003) and its owner id is the draft id (422-FR-004), so the keys belong to the draft and its clean-up deletes exactly them (114-FR-016).

_From 110-workshop-photos._

### 110-FR-005 — Every photo endpoint of this story (upload address, confirm, read, delete; reordering is the ordinary draft save) MUST be public (no session) and resolve the draft from the token header exactly as the draft endpoints do (114-FR-007): a missing, wrong or foreign token and a deleted draft answer 404 with the same body and touch nothing; a `submitted` draft answers 409 (114-FR-012) and a confirm against it deletes the uploaded object. Responses carry `Cache-Control: no-store` (114-FR-021).

_From 110-workshop-photos._

### 110-FR-006 — The draft MUST hold its photos as an ordered list of file keys, in the draft's data (`data.files`, the place 114 reserved for file keys, first key = cover). The order is saved by the form with the rest of the draft (114-FR-005; the whole data, the last save wins) and MUST be restored by the browser copy, by the server copy and by the continue link in the same order (114-FR-002, 114-FR-011, 114-FR-013). The server MUST accept in a save only keys the draft already holds (a key added by a confirm), in any order, never a new or foreign key, so a save cannot claim another draft's file; a held key the save leaves out (an older browser copy saved after a confirm) is kept and added back at the end, so only the photo delete (FR-009) removes a key. The draft's key pattern (`libs/contracts/src/listing-drafts.dto.ts`) MUST accept the storage key shape `<purpose>/<owner id>/<id>` with `_` in the purpose, which it refuses today.

_From 110-workshop-photos._

### 110-FR-007 — Each uploaded photo MUST show as a thumbnail in the step with its progress bar while uploading, a spinner while its processed copies are not ready, and the thumbnail once they are; the thumbnail of a photo chosen on this device MAY be the local file while the copies are not ready. On another device or after a reload the thumbnails MUST come from storage through signed, short-lived download addresses issued only to the draft's token (`GET /api/v1/listing-drafts/{id}/photos`: key, position, whether processed, width and height, thumbnail address). A photo is processed when its thumbnail exists in storage; the width and height are kept as metadata on the thumbnail object, with no new table and no new field in the draft's data, never a public address.

_From 110-workshop-photos._

### 110-FR-008 — The owner MUST be able to reorder the photos by dragging a thumbnail (pointer, touch) and by keyboard: every thumbnail carries "Mută înainte" / "Move earlier" and "Mută înapoi" / "Move later" buttons, disabled at the ends, that move it one place; focus stays on the moved photo and the new position is announced politely to assistive technology ("Fotografia <n> din <m>" / "Photo <n> of <m>"). The first photo MUST carry a visible "Copertă" / "Cover" mark, told by text, not colour alone. A reorder MUST be saved like any other draft change.

_From 110-workshop-photos._

### 110-FR-009 — Every thumbnail MUST carry "Șterge" / "Remove", reachable by keyboard and named with the photo's position; removing MUST take the photo out of the step at once, close the gap in the order, mark the new first photo as the cover, cancel an upload still in flight, and delete the file and its processed copies from storage through the storage call of FR-003, which the draft clean-up (114-FR-016) also uses (`DELETE /api/v1/listing-drafts/{id}/photos/{key}`; a key the draft does not hold answers 404). A storage delete that fails MUST not keep the photo in the draft: the key leaves the draft and the orphan is reported in the logs.

_From 110-workshop-photos._

### 110-FR-010 — After a confirm the worker MUST process the photo from a queue job: read the original, remove every location and other metadata (EXIF, XMP, IPTC) from the copies, make a thumbnail at most 400 px on its long side and a display copy at most 1,600 px, both JPEG (a PNG or WebP original keeps its format for the display copy, JPEG for the thumbnail), and record the original's width and height; the original stays untouched and private. A job that fails is retried by the queue (3 attempts with back-off) and then logged with the key and the draft id, never the e-mail (114-FR-018); the photo stays in the draft. A job whose original no longer exists (the photo was removed meanwhile) ends without error and writes no copy. The processed copies live beside the original under the same owner, the thumbnail carrying the original's width and height as object metadata, and are deleted with it by the storage call of FR-003.

_From 110-workshop-photos._

### 110-FR-011 — When the listing is sent, the sending story MUST be able to turn the draft's photos into gallery rows in one call this story provides: one `garage_photo` row per key, in the draft's order (position 0 = cover), with the file key, the width and height when processed, and `created_at`, written inside the sending story's transaction. The files are not moved: they stay under the draft's keys, which the draft clean-up never touches once the draft is `submitted` (114-FR-016). No row, no audit entry and no event is written before the listing is sent (114-FR-018): the audit entry for the starting photos belongs to the sending story, with the account.

_From 110-workshop-photos._

### 110-FR-012 — The photos of a draft and the gallery rows of an unapproved garage MUST be reachable only through signed addresses issued to the draft's token (FR-007), and, later, to MotorFix admins in the verification file (that story); this story MUST publish no public address for any photo. Public serving of the display copies after approval belongs to the public gallery story.

_From 110-workshop-photos._

### 110-FR-013 — While the device is offline the step MUST keep the chosen files in a browser queue for as long as the page is open, show them as waiting, and upload them in order when the connection returns; files waiting when the page is closed are lost and the owner is told nothing more than that they are not in the draft (they are simply absent). When the API refuses to issue addresses (storage down, 5xx), the rest of the draft MUST keep saving and a line "Fotografiile se încarcă mai târziu" / "The photos will upload later" MUST show under the drop area until an upload succeeds; each waiting file is retried on the next drop, on "Reîncearcă" and when the connection returns.

_From 110-workshop-photos._

### 110-FR-014 — The step MUST say what is needed when photos cannot be taken yet: without a server copy (no e-mail at step 1, 114-FR-005) the drop area reads "Adaugă un e-mail la pasul 1 ca să încarci fotografii" / "Add an e-mail at step 1 to upload photos" and takes no files; the line goes away as soon as the server copy exists.

_From 110-workshop-photos._

### 110-FR-015 — Switching the language MUST change every text of the step (drop area, buttons, marks, messages) and keep every photo, its order and its state (108-FR-009).

_From 110-workshop-photos._

### 110-FR-016 — The step MUST obey the page's phone layout rules (108-FR-011): no sideways scroll at 320 px, thumbnails in a wrapping grid, 44 px targets for the buttons on each thumbnail, text at least 12 px, light and dark theme following the device, a 3:1 focus ring and 4.5:1 text contrast with Cockpit tokens; the drop area's drag-over state and the drop placeholder are told by more than colour; progress, refusal messages and order changes are announced through a polite live region.

_From 110-workshop-photos._

### 110-FR-017 — The draft's step 5 completeness for photos MUST be exported for the sending story as a function: at least 1 photo whose upload is confirmed; this story adds no tick or check of its own to the step list (108-FR-010).

_From 110-workshop-photos._

### 110-FR-018 — Every new endpoint (upload address, confirm, read, delete) and the processing queue MUST carry the platform's telemetry (ST-875–881: a span per call and job, the job's duration and outcome counted, a failure logged with the key), and the PR's Notes MUST list the observability reports for them.

_From 110-workshop-photos._

### 110-FR-019 — Tests MUST cover, in Jest on real PostgreSQL and Redis with the test store: an upload address issued only to a valid draft token (a wrong, foreign, missing token and a `submitted` draft refused, nothing issued); a disallowed type, a file above 10 MB and the 21st photo refused with stable codes; a HEIC declaration refused and a non-photo refused at confirm; the order saved by a save and restored by the read, a foreign key in a save refused; the delete removing the key, the object and its copies; a save leaving out a held key keeping it; the 21st photo refused at the upload address and at confirm; the processing removing location data from the copies (a JPEG fixture with GPS tags), making the two sizes and recording the dimensions; the gallery rows created in order by the sending call. Unit tests in the web app cover the drop area wording by kind of business, the pointer and keyboard reorder, the cover mark, the refusal messages and the offline queue. A Playwright end-to-end test MUST upload 3 photos, move the last to the first place, reload and check the order, then remove one and check it is gone, at the sweep's sizes.

_From 110-workshop-photos._
### 885-FR-001 — On restore, a stored browser draft MUST be checked by the same draft-data rule the server applies on save (`isListingDraftData` in the contracts library: the envelope `steps`, `survey`, `files` and nothing else, every step section under a known step 1–6 and passing that step's guard, `files` a list of well-formed file keys, `survey` an object), in addition to the envelope checks already made (step, language, dirty flag, optional token, draft id and e-mail). The copy fetched from the server is not checked again in the browser: the server validated it on save.

_From 885-restored-draft-check._

### 885-FR-002 — A stored entry whose data fails that rule MUST be treated as no browser copy at all: the page opens as it would with nothing stored (an empty form at step 1; a continue link still takes the server copy), its token is not used, and nothing is thrown to the owner.

_From 885-restored-draft-check._

### 885-FR-004 — The rule applied in the browser and the rule applied by the server MUST be one rule, not a browser-side copy: the same fixtures get the same verdict on both sides.

_From 885-restored-draft-check._

### 885-FR-005 — Tests MUST cover, in colocated Jest specs: each refused shape of FR-001 (an extra envelope key, an unknown step key, a step section failing its guard, bad `files`, a non-object `survey`) restoring nothing and throwing nothing; a passing draft, a dirty passing draft with a token and an empty `{}` data restoring as today; and the same fixtures judged alike by the browser restore and the server rule (FR-004).

_From 885-restored-draft-check._
### 111-FR-001 — Step 5 of "List your garage" MUST show, in the page's language, after the photos' place and before ST-112's "Program" block, the field "Adresă" / "Address" with the placeholder "Stradă și număr, sector, oraș" / "Street and number, sector, town" (required for the step to be complete), a map under it, and the button "Pune pinul pe hartă" / "Place the pin on the map"; when step 1's `businessKind` is `mobile` the field is labelled "Sediul înregistrat" / "Registered seat" and a second control "Zona în care lucrezi" / "Area you work in" appears, a whole number of kilometres with the hint "Între 1 și 100 km" / "Between 1 and 100 km", showing 20 when the section holds no radius. Every label, hint, placeholder and error exists in Romanian and English.

_From 111-garage-address-map._

### 111-FR-002 — From the third character typed, 300 ms after the last keystroke, the field MUST ask the API's address look-up for suggestions and show at most 5 as buttons reachable by keyboard, each the suggestion's text; fewer than three characters show none and ask nothing; a newer text's answer always replaces an older one, never the other way round. Choosing a suggestion MUST fill the field with its text and set the position to the suggestion's point; a text with no suggestion shows a line saying nothing was found and offers the manual pin.

_From 111-garage-address-map._

### 111-FR-003 — The map MUST be drawn with MapLibre and show one draggable pin at the position once there is one, centred on it at street zoom 16 (a named constant beside the Romania bounds); dragging the pin, or the one map tap that follows "Pune pinul pe hartă" (the button arms one tap, which places the pin and disarms; with a pin already there a tap does nothing and the pin is moved by dragging), MUST set the position to where the pin lands and leave the address text untouched. For a mobile mechanic the map MUST draw a circle of the radius around the position and redraw it when the radius changes. The suggestions MUST be operable by keyboard alone (Tab/arrow keys move, Enter chooses, Escape closes the list), the field MUST announce the suggestion count to assistive technology, and the pin MUST have a keyboard path: with focus on the map the arrow keys nudge a placed pin, so a hand-placed or corrected position never needs a pointer. The pin and the map controls MUST be usable at 320 px with no sideways scroll, at least 44 px tall where they are controls, and readable in light and dark (`phone-layout.md`).

_From 111-garage-address-map._

### 111-FR-004 — When the look-up answers the "search down" state or cannot be reached, the step MUST show "Căutarea adresei nu merge acum" / "Address search is not working right now" under the field and keep the field and the manual pin usable; when the map's style or tiles fail to load, or the map cannot start, the map area MUST say the map could not be loaded ("Harta nu s-a putut încărca" / "The map could not be loaded"), the address stays editable and kept, and the step stays incomplete until a position exists.

_From 111-garage-address-map._

### 111-FR-005 — The radius MUST accept whole numbers from 1 to 100 only, 20 being the default when none was given (one named constant, `MOBILE_SERVICE_RADIUS_DEFAULT_KM`, in the shared contracts library, read by the web app and the write); a value outside, a fraction or a non-number MUST be refused in the field with the hint of FR-001 and MUST NOT replace the last good value.

_From 111-garage-address-map._

### 111-FR-006 — The step's values MUST be the `place` key of the draft's step-5 section (`steps['5'].place`, beside ST-112's `hours`, `closedDays` and `facilities`, 112-FR-007): `address` (string, at most 200 characters, absent or empty allowed while typing, the typed or chosen text; for a mobile mechanic the registered seat), `lat` and `lng` (numbers, both present or both absent), and `radiusKm` (integer 1–100 or absent). It MUST be typed in the shared contracts library and checked by one guard where the API and the web app both read it, joined into the step-5 guard the draft envelope already runs (`libs/contracts/src/listing-drafts.dto.ts:50`): a `place` with another key, a wrong type, a 201-character address, one coordinate without the other or a radius outside the limits is refused with 400 and the draft's stable validation code; a section without `place` is accepted. The values are kept with the rest of the form (browser copy and server copy, 114-FR-002, 114-FR-005), restored on reload and through the continue link (114-FR-011), and MUST write nothing to the garage tables, the audit history or the outbox while there is no account (114-FR-018).

_From 111-garage-address-map._

### 111-FR-007 — Step 5's place is complete when `address` is non-empty and a position exists inside Romania; a mobile mechanic's radius never blocks completeness (20 stands in). A position outside Romania MUST show "Adresa trebuie să fie în România" / "The address must be in Romania" at the map and make the place incomplete. Romania is one bounding box held in one named place in the shared contracts library (latitude 43.5 to 48.4, longitude 20.2 to 29.8), read by the web app, the look-up and the write; no second copy may exist.

_From 111-garage-address-map._

### 111-FR-008 — The API MUST offer `GET /api/v1/places?q=<text>[&lang=ro|en]` (`lang`, default `ro`, only picks the label language), open to visitors without a session (`@Public()`, listed with the public routes), answering `{ items: [{ label, lat, lng }] }` with at most 5 items, every item inside Romania's bounding box (FR-007), for a trimmed `q` of 3 to 200 characters; a shorter, longer or missing `q` is refused as a bad request in the API's one error shape (`validation_failed`). The answer MUST send `Cache-Control: no-store` for nothing of the owner's typing to be cached on the way.

_From 111-garage-address-map._

### 111-FR-009 — The look-up MUST go through one provider port in a `places` module of its own in the domain library (`libs/domain/src/places/`, which ST-229 and the drivers' search reuse unchanged) (`PlacesProvider`: a text in, candidate places out), with exactly two implementations: the real provider and a fake. Which one serves is decided once at boot: a key set → the real provider; no key and `APP_ENV=test` → the fake; no key otherwise → no provider, the "search down" state (FR-010). The fake MUST serve `APP_ENV=test` and the end-to-end boot with a fixed list of Romanian addresses (one for "Str. Ștefan cel Mare 12, Sector 2" at a point in Bucharest, one text that finds nothing) and is what the unit, API and Playwright tests use; no test reaches the outside provider. The real provider MUST be asked with the query, a limit of 5 and Romania as the only country, and MUST wait at most 3 seconds.

_From 111-garage-address-map._

### 111-FR-010 — The provider's key MUST be read from the server's environment through the shared env reader (`libs/contracts/src/env.ts`, a named optional set as `GOOGLE_ENV` is) and listed in `.env.example` with its one comment line; it MUST never reach the browser, a log or an error message. A missing key MUST NOT stop the API from booting: outside `APP_ENV=test` the look-up then answers the "search down" state, as it does when the provider fails, times out or refuses the key: 503 in the API's one error shape with the stable code `search_unavailable`, nothing cached, and one warning log per boot that the key is missing, without its value.

_From 111-garage-address-map._

### 111-FR-011 — The look-up MUST be limited per source address by a Redis counter in the pattern of the drafts' throttle (114-FR-021, one shared helper, never a second copy): 60 calls per minute; past it the answer is 429 with the stable code `places_rate_limited` and the provider is not called. The counter never holds the only copy of anything (Constitution VI): it is a limit, not data.

_From 111-garage-address-map._

### 111-FR-012 — The garage row MUST gain `address` (text, 1–200 characters or null, CHECK in the migration), `seat_address` (the same rule), `location` as two columns `latitude` and `longitude` (`double precision`, WGS84, both set or both null by CHECK, each inside its range by CHECK) and `service_radius_km` (integer 1–100 or null, CHECK in the migration), all null for the garages that exist today; a row MUST never hold both `address` and `seat_address` (CHECK). No PostGIS extension is created: staging and production run Railway's `postgres-ssl:18` template, which has none, and the migration runs as the api's pre-deploy step (`scripts/railway-deploy.ts:294`); moving the position to `geography` with a GiST index is MF-10's, deferred.

_From 111-garage-address-map._

### 111-FR-013 — The `garages` module MUST provide one write that saves a garage's place from the step-5 `place` section inside a transaction the caller owns (the sending story runs it with 109-FR-013's and 112-FR-009's writes), taking the transaction, the actor (the owner account created in it), the garage and the section. It MUST trim the address and check its length (code `length` on `address`), require a position (code `required` on `location`) inside Romania (FR-007; code `romania` on `location`), and refuse a radius outside 1–100 (code `range` on `radiusKm`); a refusal is the 422 field-error refusal the other writes raise and writes nothing. For a garage whose `business_kind` is not `mobile` it writes `address` and `location` and leaves `seat_address` and `service_radius_km` null; for `mobile` it writes `seat_address`, `location` (the seat) and `service_radius_km` (the section's radius, else 20) and leaves `address` null. No route calls it in this story; it is tested on a real database.

_From 111-garage-address-map._

### 111-FR-014 — In the same transaction the write MUST record the starting values once in the audit history through the existing audit writer (`recordChanges`, as 109-FR-017 does): one `update` entry per field written on the garage from null to the value, subject type `garage`, actor the owner, the position recorded as `{ lat, lng }`; it MUST emit no event and notify nobody (the garage is not public yet).

_From 111-garage-address-map._

### 111-FR-015 — The public garage read (`GET /api/v1/garages/:slug`, `PublicGarageDto`) MUST carry `address` (string or null), `latitude` and `longitude` (numbers or null, both set or both null; the plan's contract names them flat) for a garage whose `business_kind` is not `mobile`, and `serviceRadiusKm` (integer or null) with `address`, `latitude` and `longitude` all null (absent) for a mobile mechanic, whatever the row holds; a garage with no place yet carries null in all of them. The brand-first search's item (042-FR-012, 042-FR-013) is unchanged: the pins of the results map are MF-10's.

_From 111-garage-address-map._

### 111-FR-016 — No public shape of the API MUST carry the registered seat [X20c]: no DTO reachable from a `@Public()` route, read or list, has a property for `seat_address` (in any spelling), and the public garage read of a mobile mechanic has no position (the seat is the position). `seat_address` is read only by the garage's own staff and MotorFix admins through the later dashboard and admin stories, which are not this one. A test MUST read the generated OpenAPI document and fail on any property whose name contains `seat` in a schema reachable from the responses of the routes in the public routes list, and the public routes list MUST gain `GET /api/v1/places`.

_From 111-garage-address-map._

### 111-FR-017 — The real map style and tiles MUST never be reached by the Playwright suite or the PR QA run: the web app reads its map style address from one place and the end-to-end and QA boots give it a local, empty style (no outside request), so screenshots and tests are the same every run; MapLibre GL JS is the only new front-end dependency (BSD licence, Constitution III), and the map's attribution is shown as the tile provider's terms require.

_From 111-garage-address-map._

### 111-FR-018 — Tests MUST cover, in Jest: the `place` guard (good sections, each wrong key, type and length, one coordinate alone, radius 0, 1, 100, 101 and 12.5), completeness (no address, no position, outside Romania, mobile with no radius), the Romania bounding box, the look-up's trimming and 3-character floor, the debounce and the latest-answer rule, the radius default; in Jest on real PostgreSQL and Redis: the look-up passing the query to the fake provider and answering at most 5 results inside Romania, the "search down" answer with no key and with a failing provider, the throttle's 429, a draft saved with `place` and read back unchanged, a malformed `place` refused with 400 while a section without it is accepted, the write for a workshop (address and location set, seat and radius null), for a mobile mechanic (seat, location and 35 set, address null; 20 when the section has no radius), the refusals (no position, outside Romania, 201 characters, radius 101) writing nothing, the audit entries, the public read of each kind and the OpenAPI `seat` check, and the public routes list with `GET /api/v1/places`. A Playwright end-to-end test MUST, at a phone width with the fake provider and the empty map style: type "Str. Ștefan cel Mare 12, Sector 2", choose the suggestion, see the pin, drag it, reload and check the position moved and the text stayed; as a mobile mechanic, set 35 km, reload and find 35 and "Sediul înregistrat".

_From 111-garage-address-map._

## Retired

- `108-FR-012` — superseded by `114-FR-018` (2026-10-07)

- `354-FR-008` — superseded by `109-FR-015` (2026-10-08)
- `354-FR-009` — superseded by `109-FR-016` (2026-10-08)
- `354-FR-010` — superseded by `109-FR-017` (2026-10-08)
- `108-FR-006` — superseded by `861-FR-008` (2026-10-08)

- `114-FR-016` — superseded by `110-FR-003` (2026-10-08)
- `114-FR-002` — superseded by `885-FR-003` (2026-10-08)
