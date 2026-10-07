import './telemetry';

import { readEnv } from '@motor-fix/contracts/env';

import { createServer } from './server';

readEnv([]);
createServer().listen(Number(process.env['PORT'] ?? 3002));
