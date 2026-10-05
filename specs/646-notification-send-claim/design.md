# Design check — 646-notification-send-claim

- Story: ST-646 https://app.notion.com/p/3f0607bff0d2817da2d9fb5babd9f5cd (Tech debt, from ST-555).
- Design / Design boards: empty rollups; the task has no Build brief and no Screens section.
- Screens touched: none. The change is in the notifications worker (`libs/domain/src/notifications/notifications.processor.ts`) and the `notification` table; nothing a person sees changes except that a message arrives once.
- Not designed: nothing needed. Mock not opened: no board to open.
- Disagreements between mock and brief: none.
