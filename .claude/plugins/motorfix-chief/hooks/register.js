// The one hooks module (hooks.json): each part's hooks live in its own file and
// are wired here, in the order contracts/denials.md gives. A hook may be
// imported; `$` and `on` never cross a file as arguments, and each event
// takes one hook without a matcher, so its parts share that hook's file.

import { bandHook, paneHook } from './board.js';
import {
  bashHook,
  contextHook,
  endHook,
  startHook,
  submitHook,
} from './chief-control.js';
import { agentHook } from './dispatch-guard.js';
import { CARD, PANE } from './lib/surface.js';
import { cardHook, cardPaneHook } from './owner-card.js';
import { resultHook } from './quiet-transcripts.js';
import { measureHook } from './usage-guard.js';
import { turnHook } from './worker-report.js';

// A gating hook that fails lets the call through: the mod never blocks on its own error.
const failOpen = (_$, e, next) => next(e);

export function register(on) {
  on('tool.call', { tool: 'Agent' }, agentHook).catch(failOpen);
  on('session.start', startHook);
  on('session.end', endHook);
  on('tool.call', { tool: 'Bash' }, bashHook).catch(failOpen);
  on('prompt.submit', submitHook).catch(failOpen);
  on('prompt.context', contextHook);
  on('ui.render', { component: 'AbovePrompt' }, bandHook);
  on('ui.render', { component: 'Pane', requestId: PANE.id }, paneHook);
  on('tool.call', { tool: 'AskUserQuestion' }, cardHook).catch(failOpen);
  on('ui.render', { component: 'Pane', requestId: CARD.id }, cardPaneHook);
  on('ui.render', { component: 'ToolResult' }, resultHook);
  on('session.measure', measureHook);
  on('turn.complete', turnHook);
}
