import { angularTest, WEB_NODE_SPECS } from '../../vitest.shared.ts';

export default angularTest('apps/web', 'node', { only: WEB_NODE_SPECS });
