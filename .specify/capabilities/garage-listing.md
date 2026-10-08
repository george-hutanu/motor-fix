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
  - 861-jump-holds-step
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

### 354-FR-008 — The `garages` module MUST provide one write that saves a garage's starting prices inside a transaction the caller owns, taking the garage, the actor (the owner account created in that transaction) and the step-3 payload: the labour range (both ends required: a missing end is refused with code `required` before the range check runs; the range check, `wide_range` included, applies to it) and a list of jobs, each with a catalogue job id, an optional brand id, from, optional to and optional duration. It MUST write the labour range on the garage and one price row per job in payload order with `visible = true`, `position` 0, 1, 2…, `updated_at` now and `updated_by` the actor; a job with no top is stored with `to_bani` empty and `visible = true` (the public rule, ST-357, hides it on read; this story stores no "hidden" mark for it).

_From 354-job-catalogue-prices._

### 354-FR-009 — The write MUST check every range with FR-006 and refuse the whole payload on any error, the duplicate `(job, brand)` pair within the payload, a brand range whose job has no default range in the payload, an unknown job, a job that is not `approved`, or an unknown brand, each as a field error naming the row; it MUST write nothing when it refuses, and because it runs in the caller's transaction, a caller that fails afterwards MUST leave no price row, labour range or audit entry behind, the listing draft untouched.

_From 354-job-catalogue-prices._

### 354-FR-010 — In the same transaction the write MUST record the starting values once in the audit history through the existing audit writer: one `create` entry per price row (subject type `garage_price`, the row's values as the new value, the garage id as scope) and one `update` entry per labour field on the garage from null to the value (subject type `garage`, fields `labour_from_bani`, `labour_to_bani`, through `recordChanges`), actor the owner. The write MUST emit no event and notify nobody: the garage is not public yet.

_From 354-job-catalogue-prices._

### 354-FR-011 — The write MUST return the saved rows and the warnings per row and for the labour range, so the sending story's response can carry `wide_range` where it applies.

_From 354-job-catalogue-prices._

### 354-FR-012 — Tests MUST cover, in Jest on real PostgreSQL: the load is idempotent and atomic; lei ↔ bani; the range check's table (top below bottom refused, empty top allowed, the 1 leu and 100.000 lei bounds, the duration steps, the 3 × warning and the exactly-3 × non-warning); the unique rule with an empty brand at the database; the write creating the garage's labour range, the rows and the audit entries in one transaction; a refused payload storing nothing; a failed caller transaction leaving nothing. The end-to-end check of step 3 through submit to the price API belongs to the stories that build those (ST-109, the sending story, ST-357) and is recorded here as deferred.

_From 354-job-catalogue-prices._

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

## Retired

- `108-FR-012` — superseded by `114-FR-018` (2026-10-07)

- `108-FR-006` — superseded by `861-FR-008` (2026-10-08)
