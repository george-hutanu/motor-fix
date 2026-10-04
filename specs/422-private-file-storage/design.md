# Design: Set up private file storage with signed uploads and downloads (ST-422)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, rolled up from EP-1) · Story: https://app.notion.com/p/3ee607bff0d2815393e8ffeeca814408

No screens: the Build brief's Screens section says "None. Upload progress and errors appear inside the owning screens, through the upload helper. Not designed as a screen of its own."

## Boards
- The story's Design and Design boards properties roll up from EP-1: Sign in · dialog, Home, Mobile · Sign-in sheet, the nine mobile boards, Dashboard · Driver, A · Cockpit. None of them shows a file upload or a download; the mock was not opened for this story because no board concerns it.

## What to build to match it
- Nothing visual. The upload helper (`libs/media`) exposes progress (0–100) and a final error to the owning screen, which draws them.

## States
- Shown in the mock: none.
- Not designed (build from the Build brief, flag in the PR): upload progress, upload failed after retries, expired address renewed once. The first screen that draws them is EP-2's listing form (workshop photos).

## Mock vs Build brief
- No difference: the mock has no board for this story.
