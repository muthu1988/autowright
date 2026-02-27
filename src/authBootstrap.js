const { chromium } = require('playwright');
const fs = require('fs');

class AuthBootstrap {
  constructor(config) {
    this.config = config;
  }

  async login() {
    const browser = await chromium.launch({
      headless: false, // set true in CI
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    const loginUrl = new URL(
      this.config.loginUrl,
      this.config.baseUrl
    ).toString();

    // High-level progress: log navigation
    console.log(`Navigating to ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // Fill credentials
    await page.fill(this.config.usernameSelector, this.config.username);
    await page.fill(this.config.passwordSelector, this.config.password);

    // Submit
    await page.click(this.config.submitSelector);
    
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch (timeoutError) {
      // High-level progress: log timeout warning
      console.log('⚠️ Timeout waiting for page load after login. This may be normal for some apps. Proceeding with URL check.');
    }
    
    // Give page a moment to settle after navigation
    await page.waitForTimeout(2000);

    // Verify login success
    const currentUrl = page.url();
    if (
      this.config.successUrlContains &&
      !currentUrl.includes(this.config.successUrlContains)
    ) {
      await browser.close();
      throw new Error(
        `Login failed. Current URL: ${currentUrl}`
      );
    }

    // Save storage state
    await context.storageState({
      path: 'storage-state.json',
    });

    // High-level progress: log login success
    console.log('Login successful. Storage state saved.');

    await browser.close();
  }
}

module.exports = AuthBootstrap;
