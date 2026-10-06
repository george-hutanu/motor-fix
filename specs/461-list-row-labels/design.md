# Design check — 461-list-row-labels

Story: ST-461 https://app.notion.com/p/3ef607bff0d281bf8f19f86a7a0ca7ee (Task, Role System, EP-1 Foundations). Checked 2026-10-06.

No new screen and no visual change: the task is an accessibility fix to the shared cockpit table (`libs/ui-cockpit`) that ST-286 built from the mock's results list. The ST-286 board stays the reference: on a phone each row shows the main text at the start and the key value at the end of the same line, with no visible header. That look is kept exactly; only what assistive technology reads changes (explicit table roles, header row visually hidden instead of removed). No Build brief Screens section of its own; the task page names no board.
