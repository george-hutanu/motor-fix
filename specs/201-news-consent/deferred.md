# Deferred — 201-news-consent

Verified review findings that are real but not this change.

- Move the news fan-out to a worker job. The send loops over consenting drivers inside the request, which holds the admin's request open for the whole list and, if it fails part-way, gives the month back for a manual retry. A queued job would resume by itself. (code-reviewer, lap 1) — Notion: https://app.notion.com/p/3f0607bff0d28174bc4bc680309bc8c1
- An end-to-end test of the news e-mail arriving and its one-click link working through the mail mock. Today the e2e covers the page and consent through the API; the headers and links are covered by integration tests. (spec-reviewer, lap 1) — Notion: https://app.notion.com/p/3f0607bff0d28186895acc0314f65ac7
- Announce the unsubscribe page's result to screen readers with a live region when it changes from "stopping" to its answer. (spec-reviewer, lap 1) — Notion: https://app.notion.com/p/3f0607bff0d28115970bc65ca4c38659
