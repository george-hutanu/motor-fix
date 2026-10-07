# Design check — 574-live-hub-capabilities

**Story**: [ST-574](https://app.notion.com/p/3f0607bff0d281698e70e92df00231f6) — Tech debt (ST-254): live hub restates who may read what apart from capabilities.ts; receptionist gets review and profile kinds
**Checked**: 2026-10-07 (story page last edited 2026-10-05T08:39Z)
**Epic**: Foundations (EP-1)

## Screens

No screens: the task is server-side only (`libs/domain/src/events/live.hub.ts`
and its specs, Role System). The story has no Build brief, its `Design` and
`Design boards` properties are rollups from the epic and name no board for this
task, and no screen changes: a receptionist's dashboard simply stops being
nudged by review, profile and invite events it cannot read through the API.

## States

- None in the product. The only observable change is which live event kinds a
  receptionist's stream receives.

## Not designed

- Nothing: no screen is built from this task.

## Mock vs Build brief

- No mock and no Build brief for this task; nothing to compare.
