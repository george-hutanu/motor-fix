# Deferred — 108-step-list-in-view

- The scroll spy reads `getComputedStyle` on the bar and queries the six headings on every scroll and resize event, without coalescing. Harmless with six empty sections; revisit when the sections fill (a `matchMedia('(min-width: 768px)')` read would replace the style read). `apps/web/src/app/public/list-your-garage.ts` `follow()`.
