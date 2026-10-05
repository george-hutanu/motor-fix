# Design: Get MotorFix news only with my consent and stop it in one click (ST-201)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr · Story: https://app.notion.com/p/3ee607bff0d2812eb821e9c31b7f0b23

The mock did not render headless (the artifact read returned only its loading shell), so the boards were taken from the story's notes and the Build brief's Screens section; logged, not blocking.

## Boards
- Dashboards (Cockpit) › Dashboard · Driver › Setări · Notificări (DashClient.dc.html, MDashClient.dc.html): the switch "Noutăți MotorFix" with the line "Cel mult un e-mail pe lună". The panel is placed by ST-138, not built yet.

## What to build to match it
- The public unsubscribe page `/{lang}/unsubscribe/{token}`: **not designed**; a plain public page *(proposed)*, built like the e-mail check page (`apps/web/src/app/public/confirm-email.ts`): a heading in the public frame and a button home.
- The consent dialog under the switch: **not designed**; a short confirm dialog *(proposed)*. Not built here: its host panel is ST-138 ("Until then, test through the API"). The API takes the version the dialog shows.

## States
- Unsubscribe page: busy (server render and while the call runs), stopped ("Nu vei mai primi noutăți MotorFix"), link not valid, failed with a retry.
- Not designed: all of them; they follow the e-mail check page.

## Mock vs Build brief
- No conflict found: the mock has the switch and its line; the brief adds the consent step and the page, both marked not designed.
