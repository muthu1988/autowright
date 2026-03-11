'use strict';

/**
 * McpDynamicAnalyzer
 *
 * Spawns @playwright/mcp as a stdio subprocess and connects to it using the
 * standard MCP SDK StdioClientTransport + Client.  This keeps the Playwright
 * version used by the MCP server completely separate from the one used by the
 * rest of this project and avoids all in-process version-mixing issues.
 *
 * For each target URL the analyzer:
 *   1. Navigates via browser_navigate
 *   2. Waits for SPA hydration via browser_wait_for
 *   3. Takes an accessibility snapshot (browser_snapshot)
 *   4. Iterates interactive elements and records before/after state per click
 *   5. Saves per-route snapshot.txt + analysis.json
 *   6. Writes consolidated output/mcp-analysis/dynamic-analysis.json
 */

const path = require('path');
const fs   = require('fs');

const sdkBase = path.join(process.cwd(), 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
const { Client }               = require(path.join(sdkBase, 'client', 'index.js'));
const { StdioClientTransport } = require(path.join(sdkBase, 'client', 'stdio.js'));

class McpDynamicAnalyzer {
  /**
   * @param {object}   options
   * @param {string}   options.storageState      - Path to Playwright storage-state JSON
   * @param {string}   options.outputDir         - Directory for output artefacts
   * @param {string}   [options.baseUrl]          - Base URL to prepend to relative routes (e.g. 'https://beta.rocket.com')
   * @param {number}   [options.maxRoutes]        - Max routes to analyse (null = all)
   * @param {boolean}  [options.headless]         - Run headless (default: false)
   * @param {string}   [options.routeFile]        - Path to route-analysis.json
   * @param {string[]} [options.targetUrls]       - Explicit URL list (overrides routeFile)
   * @param {number}   [options.interactionLimit] - Max interactions per page (default: 10)
   * @param {number}   [options.navWaitMs]        - Ms to wait after navigation (default: 5000)
   * @param {number}   [options.clickWaitMs]      - Ms to wait after click (default: 2500)
   * @param {string[]} [options.skipRoles]         - ARIA roles to never interact with (default: ['link','button'])
   * @param {string[]} [options.skipLabelPatterns] - Regex patterns for button labels to skip (e.g. destructive/submit actions)
   */
  constructor(options = {}) {
    this.storageState     = path.resolve(options.storageState || path.join(process.cwd(), 'data', 'storage-state.json'));
    this.outputDir        = options.outputDir        || path.join(process.cwd(), 'output', 'mcp-analysis');
    this.testsDir         = options.testsDir         ? path.resolve(options.testsDir) : path.join(process.cwd(), 'tests');
    this.baseUrl          = options.baseUrl          ? options.baseUrl.replace(/\/$/, '') : null;
    this.maxRoutes        = options.maxRoutes        ?? null;
    this.headless         = options.headless         ?? false;
    this.routeFile        = options.routeFile        || path.join(process.cwd(), 'output', 'route-analysis.json');
    this.targetUrls       = options.targetUrls       || null;
    this.interactionLimit = options.interactionLimit ?? 10;
    this.navWaitMs        = options.navWaitMs        ?? 5000;
    this.clickWaitMs      = options.clickWaitMs      ?? 2500;

    // Roles to never click (links navigate away, buttons submit forms)
    this.skipRoles = new Set(options.skipRoles ?? ['link', 'button']);

    // Label patterns that indicate a destructive or form-submitting action.
    // Default covers common submit/confirm/pay patterns across any web app.
    const defaultSkipLabels = [
      'submit', 'confirm', 'save', 'save changes', 'apply',
      'send', 'delete', 'remove', 'cancel', 'place order',
      'complete', 'checkout', 'finish', 'done',
      // payment-domain submit verbs (generic — not page-specific)
      'pay', 'pay now', 'make payment', 'schedule payment',
    ];
    const labelPatterns = (options.skipLabelPatterns ?? defaultSkipLabels)
      .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
    this.skipLabelRe = new RegExp('\\b(' + labelPatterns.join('|') + ')\\b', 'i');

    /** @type {Client|null} */
    this.client    = null;
    /** @type {StdioClientTransport|null} */
    this.transport = null;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    const mcpBin  = path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js');

    // Build a config file so that contextOptions.storageState is honoured.
    // The --storage-state CLI flag only works with --isolated (in-memory) sessions;
    // for persistent sessions the correct channel is browser.contextOptions.storageState.
    const mcpConfig = {
      browser: {
        browserName: 'chromium',
        isolated: true,
        launchOptions: { headless: this.headless },
        contextOptions: {},
      },
    };

    if (fs.existsSync(this.storageState)) {
      mcpConfig.browser.contextOptions.storageState = this.storageState;
      console.log(`[MCP] Storage state  : ${this.storageState}`);
    } else {
      console.warn(`[MCP] Warning: storage-state not found at ${this.storageState} — proceeding unauthenticated.`);
    }

    const configPath = path.join(process.cwd(), '.mcp-runtime-config.json');
    fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf8');

    const cliArgs = ['--config', configPath];

    console.log(`[MCP] Spawning server: node cli.js ${cliArgs.join(' ')}`);

    // StdioClientTransport spawns the child process and wires stdin/stdout as the MCP transport
    this.transport = new StdioClientTransport({
      command: process.execPath,     // full path to node.exe
      args: [mcpBin, ...cliArgs],
    });

    this.client = new Client(
      { name: 'autowright', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await this.client.connect(this.transport);
    console.log('[MCP] Client connected.');

    const { tools } = await this.client.listTools();
    console.log(`[MCP] ${tools.length} tools available: ${tools.map(t => t.name).join(', ')}`);
  }

  async stop() {
    try { await this.client?.close();    } catch (_) {}
    try { await this.transport?.close(); } catch (_) {}
    // Remove the temporary runtime config file
    const configPath = path.join(process.cwd(), '.mcp-runtime-config.json');
    try { if (fs.existsSync(configPath)) fs.unlinkSync(configPath); } catch (_) {}
    console.log('[MCP] Client disconnected.');
  }

  // ─── Tool wrappers ─────────────────────────────────────────────────────────

  async callTool(name, args = {}) {
    const result = await this.client.callTool({ name, arguments: args });
    if (result?.isError) {
      const msg = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ');
      throw new Error(`MCP tool "${name}" error: ${msg}`);
    }
    return result;
  }

  async navigate(url) {
    return this.callTool('browser_navigate', { url });
  }

  async wait(ms) {
    return this.callTool('browser_wait_for', { time: ms / 1000 });
  }

  async snapshot() {
    return this.callTool('browser_snapshot');
  }

  async click(ref, element = 'element') {
    return this.callTool('browser_click', { ref, element });
  }

  async selectOption(ref, element, values) {
    return this.callTool('browser_select_option', { ref, element, values });
  }

  // ─── Stable locator generation ─────────────────────────────────────────────

  /**
   * Build a stable Playwright locator expression from an ARIA role + label.
   * These survive across sessions (unlike ephemeral ARIA refs like e42).
   *
   * Examples:
   *   button "Continue"  →  page.getByRole('button', { name: 'Continue' })
   *   checkbox "Auto-pay" →  page.getByRole('checkbox', { name: 'Auto-pay' })
   *   combobox "Payment type" → page.getByRole('combobox', { name: 'Payment type' })
   */
  toLocator(role, label) {
    const roleExact = [
      'button', 'link', 'checkbox', 'radio', 'tab',
      'menuitem', 'option', 'combobox', 'switch', 'spinbutton',
      'treeitem', 'menuitemcheckbox', 'menuitemradio',
    ];
    if (roleExact.includes(role)) {
      return `page.getByRole('${role}', { name: '${label.replace(/'/g, "\\'")}' })`;
    }
    // Fallback: label-based locator
    return `page.getByLabel('${label.replace(/'/g, "\\'")}')`;
  }

  // ─── Combobox option extraction ─────────────────────────────────────────────

  /**
   * Given an ARIA snapshot string and the ref of a combobox, return the list
   * of child `option` elements (label + optional ref).  Works by finding the
   * combobox line in the YAML tree and collecting all more-deeply-indented
   * `- option` lines until indentation returns to the combobox level.
   */
  parseComboboxOptions(ariaText, comboboxRef) {
    const lines = ariaText.split('\n');
    const options = [];
    let inCombobox = false;
    let comboboxIndent = -1;

    for (const line of lines) {
      if (!inCombobox) {
        if (line.includes(`[ref=${comboboxRef}]`)) {
          inCombobox = true;
          comboboxIndent = line.length - line.trimStart().length;
        }
      } else {
        const trimmed = line.trimStart();
        if (trimmed === '') continue;
        const currentIndent = line.length - trimmed.length;
        if (currentIndent <= comboboxIndent) break; // back at sibling level
        const optMatch = trimmed.match(/^-\s+option\s+"([^"]+)"(?:\s+\[ref=(e\d+)\])?/);
        if (optMatch) {
          options.push({ label: optMatch[1], ref: optMatch[2] || null });
        }
      }
    }
    return options;
  }

  // ─── Snapshot parsing ──────────────────────────────────────────────────────

  parseSnapshot(snapshotResult) {
    const contents = snapshotResult?.content || [];
    const ariaText = contents
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    const interactiveRefs = [];
    const refRe = /\[ref=(e\d+)\]/;
    const interactiveRoles = new Set([
      'button', 'link', 'checkbox', 'radio',
      'menuitem', 'tab', 'option', 'combobox',
      'switch', 'treeitem', 'menuitemcheckbox', 'menuitemradio',
      'spinbutton',
    ]);

    // Build an exact-match role regex: ` role "label"` or ` role [` — avoids
    // 'spinbutton' matching 'button', 'menuitemcheckbox' matching 'checkbox', etc.
    const rolePattern = new RegExp(
      '\\b(' + [...interactiveRoles].join('|') + ')(?:\\s+"|\\s+\\[|\\s*$)',
      'i'
    );

    // Extract only lines within the <main> landmark to avoid nav/header/footer noise.
    // The ARIA snapshot uses YAML-style indentation; we detect the `- main` line,
    // record its indent depth, then collect all lines that are indented deeper until
    // we return to the same depth (a sibling landmark).
    const allLines = ariaText.split('\n');
    let inMain = false;
    let mainIndent = -1;
    const mainLines = [];

    for (const line of allLines) {
      const trimmed = line.trimStart();
      const currentIndent = line.length - trimmed.length;

      if (!inMain) {
        // Match "- main" or "- main [" (the ARIA main landmark)
        if (/^-\s+main(\s|\[|$)/.test(trimmed)) {
          inMain = true;
          mainIndent = currentIndent;
          mainLines.push(line);
        }
      } else {
        // Still inside main if this line is indented deeper than the main element itself
        if (trimmed === '' || currentIndent > mainIndent) {
          mainLines.push(line);
        } else {
          break; // Reached a sibling landmark (contentinfo, dialog, etc.) — stop
        }
      }
    }

    const scanLines = mainLines.length > 0 ? mainLines : allLines;

    for (const line of scanLines) {
      const refMatch = line.match(refRe);
      if (!refMatch) continue;

      const roleMatch = line.match(rolePattern);
      if (!roleMatch) continue;

      const labelMatch = line.match(/"([^"]+)"/);
      const role  = roleMatch[1].toLowerCase();
      const label = labelMatch ? labelMatch[1] : line.trim().substring(0, 60);
      interactiveRefs.push({
        ref: refMatch[1],
        role,
        label,
        locator: this.toLocator(role, label),
        line: line.trim(),
      });
    }

    if (mainLines.length > 0) {
      console.log(`  → main section: ${mainLines.length} lines, ${interactiveRefs.length} interactive element(s).`);
    }

    return { ariaText, interactiveRefs };
  }

  // ─── Route resolution ──────────────────────────────────────────────────────

  resolveTargetUrls() {
    if (this.targetUrls) return this.targetUrls;

    if (!fs.existsSync(this.routeFile)) {
      throw new Error(`Route file not found: ${this.routeFile}. Pass targetUrls or run the full pipeline first.`);
    }

    const analysis = JSON.parse(fs.readFileSync(this.routeFile, 'utf8'));
    const raw = (analysis.navigationStructure || [])
      .flatMap(nav => (nav.routes || []).filter(u => typeof u === 'string'));

    const urls = raw.map(u => {
      if (u.startsWith('http')) return u;
      // Relative path — require baseUrl to build a full URL
      if (this.baseUrl) return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
      console.warn(`[MCP] Skipping relative route "${u}" — supply --base-url to resolve it.`);
      return null;
    }).filter(Boolean);

    const unique = [...new Set(urls)];
    return this.maxRoutes ? unique.slice(0, this.maxRoutes) : unique;
  }

  // ─── Per-page analysis ─────────────────────────────────────────────────────

  async analysePage(url) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[MCP] Analysing: ${url}`);

    const pageResult = {
      url,
      timestamp: new Date().toISOString(),
      finalUrl: null,
      pageTitle: null,
      initialSnapshot: null,
      interactions: [],
      errors: [],
    };

    try {
      // ── 1. Navigate ───────────────────────────────────────────────────────
      console.log('  → navigating…');
      const navResult = await this.navigate(url);
      const navLines  = (navResult?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');

      const urlMatch   = navLines.match(/Page URL:\s*(\S+)/);
      const titleMatch = navLines.match(/Page Title:\s*(.+)/);
      pageResult.finalUrl  = urlMatch   ? urlMatch[1].trim()   : null;
      pageResult.pageTitle = titleMatch ? titleMatch[1].trim() : null;
      console.log(`  → landed: ${pageResult.finalUrl} — "${pageResult.pageTitle}"`);

      // ── 2. Wait for SPA hydration ─────────────────────────────────────────
      console.log(`  → waiting ${this.navWaitMs}ms for SPA hydration…`);
      await this.wait(this.navWaitMs);

      // ── 3. Accessibility snapshot ─────────────────────────────────────────
      console.log('  → capturing accessibility snapshot…');
      const initialSnap = await this.snapshot();
      const { ariaText, interactiveRefs } = this.parseSnapshot(initialSnap);

      pageResult.initialSnapshot = { ariaText, interactiveRefCount: interactiveRefs.length };
      console.log(`  → ${interactiveRefs.length} interactive element(s) found.`);
      if (ariaText) console.log(`  → preview: ${ariaText.substring(0, 200)}`);

      // ── 4. Dynamic interactions ───────────────────────────────────────────

      // Filter the interaction candidates using the configurable skip rules.
      const safeRefs = interactiveRefs.filter(({ role, label }) => {
        if (this.skipRoles.has(role)) {
          console.log(`  ⊘ skip ${role} "${label}" (role blocked)`);
          return false;
        }
        if (this.skipLabelRe.test(label)) {
          console.log(`  ⊘ skip "${label}" (matches skip-label pattern)`);
          return false;
        }
        return true;
      });

      // Use a label+role key to track which interactions we've already done so
      // that after an error recovery we can re-snapshot, get fresh refs, and
      // continue without repeating elements we already processed.
      const doneKeys = new Set();
      let remaining = safeRefs.slice(0, this.interactionLimit);
      let interactionCount = 0;

      while (remaining.length > 0 && interactionCount < this.interactionLimit) {
        const { ref, role, label, line } = remaining.shift();
        const key = `${role}::${label}`;
        if (doneKeys.has(key)) continue;

        interactionCount++;
        console.log(`  [${interactionCount}] click ${role} "${label}" [${ref}]`);

        const interaction = {
          ref, role, label, ariaLine: line,
          before: null, after: null,
          stateChanged: false, navigationOccurred: false, newUrl: null, error: null,
        };

        let needsRefresh = false;

        try {
          if (role === 'combobox') {
            // ── Combobox: enumerate options and capture page state per selection ──
            const beforeSnap = await this.snapshot();
            interaction.before = this.parseSnapshot(beforeSnap).ariaText;

            let options = this.parseComboboxOptions(interaction.before, ref);
            if (options.length === 0) {
              // Click to open the dropdown, then re-snapshot to find options
              await this.click(ref, label);
              await this.wait(1000);
              const openSnap = await this.snapshot();
              const openAria = this.parseSnapshot(openSnap).ariaText;
              options = this.parseComboboxOptions(openAria, ref);
            }

            console.log(`    ↳ combobox has ${options.length} option(s): ${options.map(o => `"${o.label}"`).join(', ')}`);

            const optionSnapshots = [];
            for (const opt of options) {
              const optBefore = await this.snapshot();
              await this.selectOption(ref, label, [opt.label]);
              await this.wait(this.clickWaitMs);
              const optAfter    = await this.snapshot();
              const optAfterAria = this.parseSnapshot(optAfter).ariaText;
              const optAfterLines = (optAfter?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
              const optUrlMatch  = optAfterLines.match(/Page URL:\s*(\S+)/);
              const optTitleMatch = optAfterLines.match(/Page Title:\s*(.+)/);
              optionSnapshots.push({
                option:       opt.label,
                optionRef:    opt.ref,
                before:       this.parseSnapshot(optBefore).ariaText,
                after:        optAfterAria,
                stateChanged: this.parseSnapshot(optBefore).ariaText !== optAfterAria,
                pageUrl:      optUrlMatch   ? optUrlMatch[1].trim()   : null,
                pageTitle:    optTitleMatch ? optTitleMatch[1].trim() : null,
              });
              console.log(`    ↳ option "${opt.label}" → ${
                optionSnapshots.at(-1).stateChanged ? '✓ state changed' : '• no change'
              }`);
            }

            interaction.optionSnapshots = optionSnapshots;
            interaction.after        = optionSnapshots.at(-1)?.after ?? interaction.before;
            interaction.stateChanged = optionSnapshots.some(o => o.stateChanged);

          } else {
            // ── Regular element: single click ────────────────────────────────
            const beforeSnap = await this.snapshot();
            interaction.before = this.parseSnapshot(beforeSnap).ariaText;

            await this.click(ref, label);
            await this.wait(this.clickWaitMs);

            const afterSnap  = await this.snapshot();
            const afterLines = (afterSnap?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
            interaction.after        = this.parseSnapshot(afterSnap).ariaText;
            interaction.stateChanged = interaction.before !== interaction.after;

            const newUrlMatch = afterLines.match(/Page URL:\s*(\S+)/);
            const newUrl = newUrlMatch ? newUrlMatch[1].trim() : null;
            if (newUrl && newUrl !== pageResult.finalUrl) {
              interaction.navigationOccurred = true;
              interaction.newUrl = newUrl;
              console.log(`    ↳ unexpected redirect → ${newUrl}. Returning…`);
              await this.navigate(url);
              await this.wait(this.navWaitMs);
              needsRefresh = true;
            }

            console.log(`    ↳ ${interaction.stateChanged ? '✓ state changed' : '• no change'}`);
          }
        } catch (err) {
          interaction.error = err.message;
          console.warn(`    ↳ error: ${err.message}`);
          try { await this.navigate(url); await this.wait(this.navWaitMs); } catch (_) {}
          needsRefresh = true;
        }

        doneKeys.add(key);
        pageResult.interactions.push(interaction);

        // After any recovery, take a fresh snapshot and rebuild the remaining
        // queue with up-to-date refs, skipping elements already processed.
        if (needsRefresh && remaining.length > 0) {
          console.log('  → re-snapshotting after recovery to refresh refs…');
          try {
            const freshSnap = await this.snapshot();
            const { interactiveRefs: freshRefs } = this.parseSnapshot(freshSnap);
            remaining = freshRefs
              .filter(({ role: r, label: l }) => !this.skipRoles.has(r) && !this.skipLabelRe.test(l))
              .filter(r => !doneKeys.has(`${r.role}::${r.label}`))
              .slice(0, this.interactionLimit - interactionCount);
            console.log(`  → ${remaining.length} element(s) remaining after refresh.`);
          } catch (_) {}
        }
      }
    } catch (err) {
      pageResult.errors.push(err.message);
      console.error(`  [ERROR] ${err.message}`);
    }

    return pageResult;
  }

  // ─── Output ────────────────────────────────────────────────────────────────

  savePageArtefacts(pageResult) {
    const slug = pageResult.url
      .replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().substring(0, 120);

    const dir = path.join(this.outputDir, 'pages', slug);
    fs.mkdirSync(dir, { recursive: true });

    if (pageResult.initialSnapshot?.ariaText) {
      fs.writeFileSync(path.join(dir, 'snapshot.txt'), pageResult.initialSnapshot.ariaText, 'utf8');
      console.log(`  → snapshot: ${dir}`);
    }
    // analysis.json is written to the tests/ mirror below — not duplicated here

    // Mirror dynamic-analysis.json into the matching tests/ folder, by URL path.
    // e.g. https://beta.rocket.com/mortgage/servicing/make-a-payment?loanNumber=...
    //   → data/analysis/mortgage/servicing/make-a-payment/dynamic-analysis.json
    try {
      const urlObj = new URL(pageResult.url);
      const segments = urlObj.pathname.replace(/^\//, '').split('/').filter(Boolean);
      if (segments.length > 0) {
        const testDir = path.join(this.testsDir, ...segments);
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(path.join(testDir, 'dynamic-analysis.json'), JSON.stringify(pageResult, null, 2), 'utf8');
        console.log(`  → tests mirror: ${testDir}`);
      }
    } catch (_) {}
  }

  // ─── Main entry ────────────────────────────────────────────────────────────

  async analyze() {
    await this.start();

    const urls = this.resolveTargetUrls();
    console.log(`\n[MCP] Targeting ${urls.length} route(s):`);
    urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

    const results = [];
    for (const url of urls) {
      const pageResult = await this.analysePage(url);
      this.savePageArtefacts(pageResult);
      results.push(pageResult);
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      totalRoutes: results.length,
      totalInteractions:    results.reduce((n, r) => n + r.interactions.length, 0),
      stateChangesDetected: results.reduce((n, r) => n + r.interactions.filter(i => i.stateChanged).length, 0),
      navigationEvents:     results.reduce((n, r) => n + r.interactions.filter(i => i.navigationOccurred).length, 0),
      results,
    };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[MCP] Analysis complete`);
    console.log(`  Routes        : ${summary.totalRoutes}`);
    console.log(`  Interactions  : ${summary.totalInteractions}`);
    console.log(`  State changes : ${summary.stateChangesDetected}`);
    console.log(`  Nav events    : ${summary.navigationEvents}`);

    await this.stop();
    return summary;
  }
}

module.exports = McpDynamicAnalyzer;

