# Deferred — 114-save-draft

- **A draft e-mail's row and its queue job are two steps.** `NotificationsService.sendToDraft` commits the notification row, then queues the job; a queue failure leaves a `queued` row nobody sends, and the reminder sweep gives its claim back, so the next day writes a second row. FR-015 asks for the reminder's `reminded_at` in the same transaction as its notification. The same shape as the existing `notify()`. Fix: requeue stale `queued` rows, or queue from the transaction's commit hook. (code review row 6, spec review row 2)
