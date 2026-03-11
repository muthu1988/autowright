import { test, expect } from '@playwright/test';

test.describe('Seed Test', () => {
  test('navigate to authenticated page', async ({ page, baseURL }) => {
    // Use POST_LOGIN_URL from environment or fall back to baseURL
    const targetUrl = process.env.POST_LOGIN_URL || baseURL;
    
    if (!targetUrl) {
      throw new Error('No target URL available. Set POST_LOGIN_URL environment variable or configure baseURL.');
    }
    
    console.log(`[seed] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl);
    
    // Basic checks to ensure page loaded successfully
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveTitle(/.+/); // Any non-empty title
    
    console.log(`[seed] ✅ Successfully loaded: ${page.url()}`);
  });
});
