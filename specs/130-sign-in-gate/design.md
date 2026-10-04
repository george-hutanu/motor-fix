# Design: Be asked to sign in when an action needs an account
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1

The story's Design boards roll up from EP-1 ("Desktop (Cockpit): Sign in · dialog", "Mobile (Cockpit): Mobile · Sign-in sheet", "Home"). Read with the Artifact tool: `project/Overlays.dc.html`, the `auth` overlay kind (lines 41–57, texts at 694–729). The board-by-board reading of that dialog is `specs/082-sign-in/design.md`, unchanged since (same mock version).

## Boards
- Sign in · dialog / Mobile · Sign-in sheet: the shared `auth` overlay over the current screen, header "Autentificare" with "MotorFix" as subtitle; its body as built by ST-82 and ST-80.
- No board shows the dialog opened by an action (quote request, review, saving a garage), a reason line, or the return to the interrupted action. The `auth` kind has a blurb slot (`auth.blurb`, line 48) used only for the driver/garage switch text.

## What to build to match it
- Reuse the built sign-in task (`apps/web/src/app/sign-in/sign-in.ts`) in the same `dialog` shape and title; add one optional line under the "MotorFix" brand line, in the same muted text style as the mock's blurb (`#B5B8BE` → `--mf-text-secondary`): "Intră în cont ca să continui." / "Sign in to continue."
- The sign-up task opened from that dialog keeps its own layout (ST-80).
- Phones: the dialog keeps ST-157's 16 px gutter at 320 and 390 px (bottom sheet is ST-158's).

## States
- Shown in the mock: the sign-in form only.
- Not designed (build from the Build brief, flag in the PR): the reason line; the return to the action (no navigation, the form keeps its values); the closed-without-sign-in state (the form's message region shows the reason).

## Mock vs Build brief
- The brief's line is action-specific ("Intră în cont ca să trimiți cererea."); no action exists yet → one generic line now; the action's own line comes with its story.
- The Build brief says the return to the interrupted action "is not designed" → built from the brief: the dialog closes over the same screen and the action goes on.
