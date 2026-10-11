// Draw only in the terminal or the desktop app, never in a cloud session.
export const canDraw = (surface, remote) =>
  (surface === 'terminal' || surface === 'desktop') && remote !== 'true';

// The board's pane (part 4), opened at Chief's start.
export const PANE = { id: 'motorfix-board', title: 'MotorFix board' };

// The owner card's pane (part 7), open while a command waits on the owner.
export const CARD = { id: 'motorfix-card', title: 'Owner command' };
