# UI contract: dashboard navigation

- Addresses: `/app/<area>` (dashboard view) and `/app/<area>/<path>` per `data-model.md`. A refused or unknown address redirects to `/app/<area>` before the view loads.
- Side menu (≥ 768 px): `nav` named "Meniu" / "Menu"; one link per allowed view, long label; the open view's link has `aria-current="page"`.
- Bottom bar (< 768 px): `mf-dashboard-tab-bar`, a `nav` named after the dashboard ("Panou șofer", "Panou service", "Panou admin" / "Driver dashboard", "Garage dashboard", "Admin dashboard"); one link per allowed view in the same order, short label; active link `aria-current="page"`, amber; tabs ≥ 44 px tall, label 12 px, grow to fit; bar scrolls sideways; bottom padding ≥ safe-area inset; hidden from 768 px.
- Header: the open view's long label as `h1`, the language switch. On a phone the aside's logo, name and "Ieși din cont" stay at the top.
