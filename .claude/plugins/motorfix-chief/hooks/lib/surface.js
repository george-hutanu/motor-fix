// FR-017: draw only in the terminal or the desktop app, never in a cloud session.
export const canDraw = (surface, remote) =>
  (surface === 'terminal' || surface === 'desktop') && remote !== 'true';

// The board's pane (part 4), opened at Chief's start.
export const PANE = { id: 'motorfix-board', title: 'MotorFix board' };
