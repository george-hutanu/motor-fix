import { angularTest, WEB_NODE_SPECS } from '../../vitest.shared.ts';

// The server specs run in node on vitest-node.config.ts.
export default angularTest('apps/web', 'jsdom', { skip: WEB_NODE_SPECS });
