import { FullConfig } from '@playwright/test';
const ensureAuth = require('../src/authentication/ensureAuth');

async function globalSetup(config: FullConfig) {
  console.log('[global-setup] Starting authentication...');
  await ensureAuth();
  console.log('[global-setup] ✅ Authentication complete');
}

export default globalSetup;