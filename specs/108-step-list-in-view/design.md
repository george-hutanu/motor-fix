# Design: Move through the six steps with the step list in view (ST-108)

[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr returned "artifact not found / not shared with this account"; filled from Notion's text. Share the mock with this session's account and re-run `speckit-design-check` to replace this note.]

Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, not opened) · Story: https://app.notion.com/p/3ee607bff0d281de8506f7904b959b0a · Epic Design table: https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf · Feature: https://app.notion.com/p/3ee607bff0d28117a3fffe7230aef5cb

## Boards

- Desktop (Cockpit) › **List your garage** (ListGarage.dc.html): the public header, the label "PENTRU SERVICE-URI", the heading "Pune-ți service-ul pe hartă", one intro line, the step list "Pași" fixed beside the form, and the six section headings (1 Service-ul, 2 Mărci, 3 Prețuri, 4 Mecanici · opțional, 5 Fotografii și adresă, 6 Verificare · obligatoriu). The board also shows the steps' content, the preview card "Cum îl vor vedea șoferii", "Salvează ciorna" and "Trimite spre verificare": those belong to later stories, not this one.
- Mobile (Cockpit) › **Mobile · List your garage** (MList.dc.html): the same page on a phone; the step list is a bar pinned under the header.

## What to build to match it

- Public frame (`apps/web/src/app/public/frame.ts`), one address per language: `/ro/list-your-garage`, `/en/list-your-garage` (one path under both prefixes, spec Clarifications; the brief proposed `/ro/listeaza-service`).
- Above the form: small uppercase label, the heading, the intro line (Build brief wording, no promise of phone calls).
- Desktop (≥ 768 px, the frame's existing breakpoint): two columns, the sections on one long page and the list "Pași" sticky beside them; a `nav` landmark named "Pași" / "Steps", numbered 1–6, the current entry highlighted with `aria-current="step"`; "opțional" after Mecanici, "obligatoriu" after Verificare.
- Phone (< 768 px): a bar pinned under the header reading "<n> / 6 · <label>"; tapping it opens the six steps; tapping one jumps and closes it.
- Jump: scroll the section under the header or bar, focus its heading; immediate under reduced motion.
- Cockpit theme tokens for the highlight and the bar; light and dark follow the device; smallest text 12 px; 44 px targets.
- Six empty section shells with their numbered headings, each with a stable fragment id for the stories that fill them.

## States

- Shown in the mock (per Notion): the fixed step list with the current step highlighted, on desktop and phone.
- Not designed (build from the Build brief, flag in the PR): the tick on a complete step (brief: proposed; nothing marks a step complete in this story, so no tick is shown); the open state of the phone bar (brief: proposed); the English texts.
- Empty: every section shows its empty shell; no ticks. No loading state of its own (the draft is ST-114's).

## Mock vs Build brief

- The mock's intro line (from the feature page) says owners who call already know you work on their car → the Build brief wins: drivers do not phone through MotorFix; the line is "Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui."
- The mock shows the steps' content, the preview card and the two buttons → out of this story's scope (brief: Out of scope); only the shell, the headings and the list are built here.
- The mock shows twelve brand buttons in step 2 → superseded (every brand sold in Romania, with search); not this story.
- The mock could not be opened, so no pixel-level difference (widths, colours, spacing) is recorded; the PR tester's screenshots are the check.
