'use strict';

require('dotenv').config();
const fs           = require('fs');
const { chromium } = require('playwright');
const McpBootstrap = require('../mcp-integration/mcpBootstrap');
const AuthBootstrap = require('./authBootstrap');

const STORAGE_STATE_FILE = 'data/storage-state.json';

/**
 * Verify the saved storage state still gives an authenticated session.
 * If not (redirected to login), run McpBootstrap + AuthBootstrap to refresh it.
 *
 * Reads POST_LOGIN_URL, SUCCESS_URL_CONTAINS, START_URL, LOGIN_USERNAME,
 * PASSWORD from environment / .env.
 */
async function ensureAuth() {
  const storageState = fs.existsSync(STORAGE_STATE_FILE) ? STORAGE_STATE_FILE : undefined;

  // Quick headless probe: navigate to the post-login URL and check where we land
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page    = await context.newPage();

  try {
    await page.goto(process.env.POST_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (_) { /* ignore load errors — we only care about the final URL */ }

  const landed = page.url();
  await browser.close();

  const isExpired = !landed.includes(process.env.SUCCESS_URL_CONTAINS);

  if (!isExpired) {
    console.log('[auth] Session is valid — no re-authentication needed.');
    return;
  }

  console.log(`[auth] Session expired (landed at ${landed}) — re-authenticating…`);

  const bootstrap = new McpBootstrap({ startUrl: process.env.START_URL, headless: false });
  const { isLoginPage, authSelectors } = await bootstrap.detect();

  if (!isLoginPage) {
    throw new Error('[auth] Expected a login page during re-auth but did not detect one.');
  }

  const auth = new AuthBootstrap({
    loginUrl:           process.env.START_URL,
    username:           process.env.LOGIN_USERNAME,
    password:           process.env.PASSWORD,
    usernameSelector:   authSelectors.usernameSelector,
    passwordSelector:   authSelectors.passwordSelector,
    submitSelector:     authSelectors.submitSelector,
    successUrlContains: process.env.SUCCESS_URL_CONTAINS,
  });

  await auth.login();
  console.log('[auth] Re-authentication complete. Fresh storage-state.json saved.');
}

module.exports = ensureAuth;
