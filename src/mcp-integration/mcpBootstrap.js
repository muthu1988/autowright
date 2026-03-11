'use strict';
/**
 * McpBootstrap
 *
 * Replaces Steps 1 + 2 (Crawlee DOM crawl + Ollama analysis) with a fast
 * MCP-based approach:
 *   1. Spawns @playwright/mcp unauthenticated
 *   2. Navigates to START_URL and takes an ARIA snapshot
 *   3. Parses the snapshot to detect whether it is a login page
 *   4. Extracts auth selectors (username, password, submit) from ARIA roles
 *
 * Returns { isLoginPage, pageType, authSelectors } — compatible with the
 * authBootstrap constructor so no other code needs to change.
 */

const path = require('path');
const fs   = require('fs');

const sdkBase = path.join(process.cwd(), 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
const { Client }               = require(path.join(sdkBase, 'client', 'index.js'));
const { StdioClientTransport } = require(path.join(sdkBase, 'client', 'stdio.js'));

class McpBootstrap {
  /**
   * @param {object}  options
   * @param {string}  options.startUrl  - URL to navigate to (from START_URL env var)
   * @param {boolean} [options.headless] - Run headless (default: false)
   * @param {number}  [options.navWaitMs] - Ms to wait after navigation (default: 4000)
   */
  constructor(options = {}) {
    this.startUrl  = options.startUrl;
    this.headless  = options.headless  ?? false;
    this.navWaitMs = options.navWaitMs ?? 4000;

    this.client    = null;
    this.transport = null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the MCP client and configure browser settings.
   * @throws {Error} If MCP client fails to initialize
   */
  async start() {
    const mcpBin = path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js');

    // No storageState — we want to see the unauthenticated page
    const mcpConfig = {
      browser: {
        browserName: 'chromium',
        isolated: true,
        launchOptions: { headless: this.headless },
        contextOptions: {},
      },
    };

    const configPath = path.join(process.cwd(), '.mcp-bootstrap-config.json');
    fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf8');

    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpBin, '--config', configPath],
    });

    this.client = new Client(
      { name: 'autowright-bootstrap', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await this.client.connect(this.transport);
    console.log('🔗 MCP client connected.');
  }

  /**
   * Stop the MCP client and clean up configuration files.
   */
  async stop() {
    try { await this.client?.close();    } catch (_) {}
    try { await this.transport?.close(); } catch (_) {}
    const configPath = path.join(process.cwd(), '.mcp-bootstrap-config.json');
    try { fs.unlinkSync(configPath); } catch (_) {}
    console.log('💤 MCP client stopped.');
  }

  // ─── MCP helpers ────────────────────────────────────────────────────────────

  /**
   * Call an MCP tool with given parameters.
   * @param {string} toolName - Name of the tool to call
   * @param {object} params - Parameters to pass to the tool
   * @returns {Promise<string>} Tool response text
   */
  async _call(toolName, params = {}) {
    const result = await this.client.callTool({ name: toolName, arguments: params });
    const text   = result?.content?.find(c => c.type === 'text')?.text ?? '';
    return text;
  }

  // ─── Main ───────────────────────────────────────────────────────────────────

  /**
   * Navigate to startUrl, snapshot the page, and return detection results.
   * @returns {{ isLoginPage: boolean, pageType: string, authSelectors: object|null }}
   */
  async detect() {
    await this.start();
    try {
      console.log(`🌐 Navigating to ${this.startUrl}`);
      await this._call('browser_navigate', { url: this.startUrl });
      await this._call('browser_wait_for', { time: this.navWaitMs / 1000 });

      const snapshot = await this._call('browser_snapshot');
      console.log('📸 Snapshot captured. Analyzing...');

      const isLoginPage   = this._detectLoginPage(snapshot);
      const pageType      = isLoginPage ? 'login' : 'authenticated';
      const authSelectors = isLoginPage ? this._extractAuthSelectors(snapshot) : null;

      if (isLoginPage) {
        console.log('🔐 Login page detected.');
        console.log(`   Username: ${authSelectors.usernameSelector}`);
        console.log(`   Password: ${authSelectors.passwordSelector}`);
        console.log(`   Submit  : ${authSelectors.submitSelector}`);
      } else {
        console.log('✅ No login page — already authenticated.');
      }

      return { isLoginPage, pageType, authSelectors };
    } finally {
      await this.stop();
    }
  }

  // ─── ARIA snapshot parsing ──────────────────────────────────────────────────

  /**
   * Detect if the page is a login page based on ARIA snapshot content.
   * @param {string} snapshot - ARIA accessibility snapshot text
   * @returns {boolean} True if login page detected
   */
  _detectLoginPage(snapshot) {
    return /- textbox "[^"]*(?:password|passcode)[^"]*"/i.test(snapshot);
  }

  /**
   * Extract authentication selectors from ARIA snapshot.
   * @param {string} snapshot - ARIA accessibility snapshot text
   * @returns {object} Object containing usernameSelector, passwordSelector, submitSelector
   */
  _extractAuthSelectors(snapshot) {
    const lines = snapshot.split('\n');

    let usernameLabel = null;
    let passwordLabel = null;
    let submitLabel   = null;

    // Patterns for fields
    const textboxRe = /^\s*-\s+textbox\s+"([^"]+)"/i;
    const buttonRe  = /^\s*-\s+button\s+"([^"]+)"/i;

    const passwordFieldRe  = /password|passcode/i;
    const usernameFieldRe  = /email|username|user name|phone|mobile|login|sign.?in/i;
    const submitButtonRe   = /sign.?in|log.?in|continue|next|submit|verify|proceed/i;

    for (const line of lines) {
      // Textboxes
      const tbMatch = line.match(textboxRe);
      if (tbMatch) {
        const label = tbMatch[1];
        if (passwordFieldRe.test(label) && !passwordLabel) {
          passwordLabel = label;
        } else if (usernameFieldRe.test(label) && !usernameLabel) {
          usernameLabel = label;
        } else if (!usernameLabel && !passwordLabel) {
          // First textbox on the page is likely username if nothing else matched
          usernameLabel = label;
        }
      }

      // Submit button
      const btnMatch = line.match(buttonRe);
      if (btnMatch && !submitLabel) {
        if (submitButtonRe.test(btnMatch[1])) {
          submitLabel = btnMatch[1];
        }
      }
    }

    // If we found a password field but no username field yet, grab the first textbox
    if (!usernameLabel) {
      for (const line of lines) {
        const tbMatch = line.match(textboxRe);
        if (tbMatch && !passwordFieldRe.test(tbMatch[1])) {
          usernameLabel = tbMatch[1];
          break;
        }
      }
    }

    // Fallback submit: any button if none matched the pattern
    if (!submitLabel) {
      for (const line of lines) {
        const btnMatch = line.match(buttonRe);
        if (btnMatch) { submitLabel = btnMatch[1]; break; }
      }
    }

    return {
      usernameSelector: usernameLabel ? `role=textbox[name="${usernameLabel}"]` : 'input[type="email"], input[type="text"]',
      passwordSelector: passwordLabel ? `role=textbox[name="${passwordLabel}"]` : 'input[type="password"]',
      submitSelector:   submitLabel   ? `role=button[name="${submitLabel}"]`    : 'button[type="submit"]',
    };
  }
}

module.exports = McpBootstrap;
