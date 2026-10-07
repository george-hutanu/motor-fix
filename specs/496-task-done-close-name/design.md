# Design check — 496-task-done-close-name

- Sources: ST-496 and ST-497 (Notion, 2026-10-04): Design and Design boards are empty rollups (tech-debt tasks, no boards); the parent story ST-159 ("Build shared saving, validation and errors for small actions") names the confirmation's button "Închide".
- Screens: none new. The confirmation inside a task (`mf-task-done`) and the error line next to the main button (`mf-task-error`), as built by ST-159 and shown in the catalogue (`/cockpit`, sample form task).
- Change against the story: the confirmation's button reads "Gata" / "Done" instead of "Închide" / "Close" (ST-496 asks for a distinct name; the task is the later source). Layout, size and focus unchanged.
- Not designed: nothing; the error line's look is unchanged, only how long it stays.
- Mock: not opened — no boards are linked to either task.
