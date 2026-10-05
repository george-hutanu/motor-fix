# Design: See live updates in place without losing my work (ST-256)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (no version stated in the mock) · Story: https://app.notion.com/p/3ee607bff0d281a39af4f03b587eb2ae

The story is the rule every live screen follows, not a screen of its own. The Build brief's Screens section says "All dashboards, desktop and mobile" and points to Driver dashboard · În direct din service. It also says the "new request" pill and the "changed meanwhile" line are not designed.

## Boards
- Dashboards (Cockpit) › Dashboard · Driver, board "În direct din service" (`DashClient.dc.html`): a new photo, clip or stream joins the top of a list of the newest 4, newest first. Only the new row animates (`mf-pop 420ms`: fade from 0 and scale from .94). There is no highlight colour, no "new" pill, no counter and no toast. The status line next to the title changes in place ("1 fotografie · 1 clip video", or "nimic trimis încă").
- Overlays › drawer "Foto, video și live" (`Overlays.dc.html`): `role="dialog"`, `aria-modal`, closes on Escape. New items get no animation and raise no toast.
- Across the mock there is no `aria-live` on the live board or the bell. A `prefers-reduced-motion: reduce` rule collapses every animation and transition.

## What to build to match it
- The test live update on every dashboard changes one value in place: a status line under the header, "Actualizare de test în direct · 14:03" / "Live test update · 14:03" (the time of the last test update). It replaces the ST-253 toast, because the Build brief rules "Live updates do not raise toasts on their own".
- A row that changed gets a short amber-tint highlight (`--mf-amber-tint`, 1 s, *proposed* in the brief), with none under reduced motion.
- The pill for new rows above the visible area: a chip at the top of the list in the Cockpit chip style (`--mf-radius-chip`, amber ink). Its text is "1 actualizare nouă" / "1 new update" *(proposed generic text; the brief's "1 cerere nouă" is the request inbox's own text, and that inbox comes with Quotes and booking)*.
- The "changed meanwhile" line: `role="status"` text under the form, "S-a schimbat între timp: <new value>" / "This changed in the meantime: <new value>" *(proposed generic text; the brief's "Lucrarea s-a schimbat între timp" is the job dialog's own text)*.
- No longer available: "Nu mai este disponibil" / "No longer available", shown in place of the drawer's body.

## States
- Shown in the mock: a new item arriving, and the status line changing.
- Not designed: the pill, the "changed meanwhile" line, the "no longer available" body, and the highlight. The brief's proposed texts and durations are used.

## Mock vs Build brief
- The mock pops a new row in (420 ms scale and fade) and has no highlight. The brief asks for a 1 s highlight on a changed row. The brief wins ("Where this section and anything above disagree, this section wins"). A row that only changed in place is highlighted, and a new row shows with the same highlight.
- The mock shows no announcement for screen readers. The brief asks for `aria-live="polite"`. The brief wins.
