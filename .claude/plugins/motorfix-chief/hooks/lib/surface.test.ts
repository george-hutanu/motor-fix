import { expect, test } from 'claude-code/testing';

import { fromRevParse } from './role.js';
import { canDraw } from './surface.js';

test('draws in the terminal and desktop app only, never in a cloud session', () => {
  expect(canDraw('terminal', undefined)).toBe(true);
  expect(canDraw('desktop', null)).toBe(true);
  expect(canDraw('vscode', null)).toBe(false);
  expect(canDraw('mobile', null)).toBe(false);
  expect(canDraw('terminal', 'true')).toBe(false);
});

test('the main checkout is Chief; a worktree is a worker', () => {
  expect(fromRevParse('/m/.git\n/m/.git\n')).toEqual({
    chief: true,
    main: '/m',
  });
  expect(fromRevParse('/m/.git/worktrees/x\n/m/.git\n')).toEqual({
    chief: false,
    main: '/m',
  });
  expect(fromRevParse('')).toEqual({ chief: false, main: null });
});
