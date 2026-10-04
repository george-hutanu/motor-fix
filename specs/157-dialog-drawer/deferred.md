# Deferred — 157-dialog-drawer

- The browser's Back button while a task is open should close the task and keep the page (Build brief scenario 8, *(proposed)*). Today the CDK closes the task as the page navigates back. Needs one history entry per open task that the router ignores, and a `history.back()` on every other close. (spec Clarifications; spec-challenger 5)
- A task whose loader fails keeps a busy skeleton with only the X working; it should show an error message and a retry, from the shared saving-and-errors story. (spec Clarifications; spec-challenger 7)
