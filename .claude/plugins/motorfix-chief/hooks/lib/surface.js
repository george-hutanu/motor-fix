// FR-017: draw only in the terminal or the desktop app, never in a cloud session.
export const canDraw = (surface, remote) =>
  (surface === 'terminal' || surface === 'desktop') && remote !== 'true';
