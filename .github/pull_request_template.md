<!--
Every PR in this repo uses this template, checked by the "PR template"
workflow. Replace every "(fill in: …)" and tick every box before marking
the PR ready; a draft only needs the headings. Where a section does not
apply, write N/A and the reason. Comments like this one may stay.
-->

## Why

_(fill in: what this PR does and why, in two or three sentences)_

## Notion story

_(fill in: the story link, e.g. https://app.notion.com/p/… (ST-n))_

<!-- The tracker issue (private george-hutanu/motor-fix-specs) this PR closes when it merges into main; leave the line as it is until the tracker is the GitHub Project. -->
Closes george-hutanu/motor-fix-specs#

## Spec folder

_(fill in: specs/NNN-slug in motor-fix-specs, or N/A and why)_

## What changed

_(fill in: the main changes, one bullet each)_

## How it was tested

- Unit: _(fill in: command and result, or N/A and why)_
- Integration: _(fill in: command and result, or N/A and why)_
- End-to-end: _(fill in: command and result, or N/A and why)_

## Observability

<!-- A new service, queue, endpoint, outside call or product action ships with its telemetry and its line in infra/observability/inventory.json. List the reports here. -->

_(fill in: what this change adds - service, queue, endpoint, outside call, product action - and the signals, dashboard panel and alert that come with it, or N/A and the reason)_

## UI evidence

_(fill in: desktop and mobile screenshots of each changed screen, or N/A: no UI change)_

## Risk and rollback

_(fill in: what could break, and how to undo it)_

## Checklist

- [ ] Title is a Conventional Commit with a scope: `type(scope): ST-n subject`
- [ ] Tests were written first and failed before the code
- [ ] Design checked: `specs/<feature>/design.md`, or the story has no screens
- [ ] Notion in sync: the story is Planning, then Implementing, QA once ready, Done on merge

## Agent review

<!-- agent-review: the automated reviewer replaces the line below -->
Pending.
