import 'dotenv/config';

import {
  assertStaffSecurityConfig,
} from './utils/staff-security-config.js';

assertStaffSecurityConfig();

await import('./server-main.js');
