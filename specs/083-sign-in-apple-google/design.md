[UNAVAILABLE: design mock — artifact not found or not shared]

# Design: Sign in with Apple or Google (ST-83)
Checked: 2026-10-05 · Story: https://app.notion.com/p/3ee607bff0d281ae87e5f2ff6afae615

The clickable mock could not be opened from this session (the artifact read answered "not found"). The boards below are taken from the story's Notes ("In the mock: The two buttons are in the Sign in dialog. They do not sign anyone in"), its Build brief › Screens, and the board notes already recorded for the same dialog in `specs/082-sign-in/design.md` and `specs/080-sign-up/design.md`. Logged, not blocking.

## Boards
- Sign in · dialog (desktop): under the amber "Intră în cont" (full width, 54 px), a divider with the word "sau", then two ghost buttons, 50 px high, full width: "Continuă cu Apple" first, then "Continuă cu Google". Then "Ești nou pe MotorFix? Creează un cont".
- Sign in · dialog, sign-up mode: the same "sau" divider and the two buttons under "Creează contul".
- Mobile · Sign-in sheet (390 px): the same order in the bottom sheet.

## What to build to match it
- The divider and both buttons, in the sign-in and sign-up tasks of the shared dialog (`apps/web/src/app/sign-in/sign-in.ts`, `sign-up.ts`): ghost buttons at 50 px with each provider's mark on the left (Apple's black-and-white logo, Google's four-colour "G"), the texts "Continuă cu Apple" / "Continuă cu Google" (EN "Continue with Apple" / "Continue with Google"). A provider whose keys are not set shows no button; with neither set, the divider is gone too.
- The terms step for a new person: **not designed** (Build brief › Screens). Built as a task of the same dialog, like the sign-up form: a short intro naming the provider, the name field prefilled from the provider (editable), the `mf-consent` tick of ST-132 above the amber "Creează contul", and "Anulează" to leave without an account.
- Progress while the provider is open: **not designed**. The flow is a full-page redirect (see Mock vs Build brief), so the tapped button shows the shared sending state until the page leaves.

## States
- Buttons: idle, sending (disabled, until the page leaves), hidden (provider not configured).
- Back from the provider, cancelled: the sign-in dialog opens again with no error.
- Back from the provider, failed: the sign-in dialog opens with "Nu am putut contacta Google. Încearcă din nou sau intră cu e-mail sau telefon." (Apple: the same with "Apple") *(proposed by the brief)*; e-mail sign-in still works.
- Back from the provider, maintenance: the sign-in dialog opens with the existing maintenance message.
- Terms step: tick empty error "Bifează pentru a continua.", sending, problem (shared task error).

## Mock vs Build brief
- The brief proposes a pop-up on a computer and a full redirect on a phone and in the installed app. This build uses the full redirect everywhere: one flow to build and test, no pop-up blocker, and Apple's form-post callback works the same on every device. The brief marks it *(proposed)*; the owner may ask for the pop-up later. (autonomous default)
