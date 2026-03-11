require('dotenv').config();
const path = require('path');
const fs = require('fs');
const AuthBootstrap = require('../src/authentication/authBootstrap');
const McpBootstrap = require('../src/mcp-integration/mcpBootstrap');
const ensureAuth   = require('../src/authentication/ensureAuth');
const RouteExplorer = require('../src/route-discovery/routeExplorer');
const RouteAnalyzer = require('../src/route-discovery/routeAnalyzer');
const { generateCrawlData } = require('../src/dom-analysis/snapshotGenerator');
const McpDynamicAnalyzer = require('../src/mcp-integration/mcpDynamicAnalyzer');
const routeConfig = require('../src/route-discovery/routeConfig');

const ROUTE_ANALYSIS_FILE = path.join('output', 'route-analysis.json');

// ─── CLI flags ──────────────────────────────────────────────────────────────
// --fresh        Wipe all cached output and LLM cache, then run everything from scratch.
if (process.argv.includes('--fresh')) {
  console.log('[run] --fresh: clearing all cached data...');
  for (const dir of ['output', 'data/analysis', '.cache']) {
    try { fs.rmSync(dir, { recursive: true, force: true }); console.log(`  deleted ${dir}/`); } catch (_) {}
  }
  for (const file of ['config/routes.config.json']) {
    try { fs.unlinkSync(file); console.log(`  deleted ${file}`); } catch (_) {}
  }
  console.log('[run] Cache cleared. Starting fresh run...\n');
}

(async () => {
  const pipelineStart = Date.now();
  try {
    let routeAnalysis;

    if (fs.existsSync(ROUTE_ANALYSIS_FILE)) {
      // ---------------------------------
      // STEPS 1–4 SKIPPED: existing route analysis found
      // ---------------------------------
      console.log(`[run] Found existing route analysis at ${ROUTE_ANALYSIS_FILE} — skipping Steps 1–4.`);
      routeAnalysis = JSON.parse(fs.readFileSync(ROUTE_ANALYSIS_FILE, 'utf8'));
    } else {
      // ---------------------------------
      // STEP 1: Detect page type via MCP snapshot (replaces Crawlee + Ollama)
      // ---------------------------------
      console.log('Detecting page type via MCP snapshot...');
      const bootstrap = new McpBootstrap({
        startUrl: process.env.START_URL,
        headless: false,
      });

      const { isLoginPage, authSelectors } = await bootstrap.detect();

      // ---------------------------------
      // STEP 2: If Login → Bootstrap auth
      // ---------------------------------
      if (!isLoginPage) {
        console.log('[run] Not a login page and no existing analysis — nothing to do.');
        process.exit(0);
      }

      const auth = new AuthBootstrap({
        loginUrl: process.env.START_URL,
        username: process.env.LOGIN_USERNAME,
        password: process.env.PASSWORD,
        usernameSelector: authSelectors.usernameSelector,
        passwordSelector: authSelectors.passwordSelector,
        submitSelector: authSelectors.submitSelector,
        successUrlContains: process.env.SUCCESS_URL_CONTAINS,
      });

      await auth.login();

      // ---------------------------------
      // STEP 3: Discover routes
      // ---------------------------------
      console.log('Exploring authenticated routes...');

      const explorer = new RouteExplorer({
        baseUrl: process.env.BASE_URL,
        startUrl: process.env.POST_LOGIN_URL,
        storageState: 'data/storage-state.json',
        maxPages: parseInt(process.env.MAX_CRAWL_PAGES  ?? '15', 10),
        maxRetries: parseInt(process.env.MAX_CRAWL_RETRIES ?? '2',  10),
      });

      await explorer.explore();
      console.log('Authenticated route exploration complete.');

      // ---------------------------------
      // STEP 4: Analyze routes for risk and business impact
      // ---------------------------------
      console.log('Analyzing discovered routes for risk and business impact...');

      const routeAnalyzer = new RouteAnalyzer({
        inputFile: 'routes.json',
        outputFile: 'route-analysis.json',
        model: process.env.LLM_MODEL || 'qwen2.5:7b',
        temperature: 0.1,
        enableCache: true,
      });

      routeAnalysis = await routeAnalyzer.analyzeRoutes();
      console.log('Route analysis complete.');
      console.log(`Categorized ${routeAnalysis.totalRoutes} routes into ${routeAnalysis.categories?.length || 0} categories.`);
      console.log(`High-risk routes identified: ${routeAnalysis.riskSummary?.high || 0}`);
    }

    // Sync all discovered routes into routes.config.json (new routes default to "excluded")
    routeConfig.sync(routeAnalysis);

    // Resolve which routes are marked "included" for Steps 5–7
    const includedUrls = routeConfig.getIncluded(process.env.BASE_URL);

    if (includedUrls.length === 0) {
      console.log('\n[run] No routes marked as included in routes.config.json — skipping Steps 5, 6 and 7.');
      console.log('[run] To process routes: open routes.config.json and set status to "included" for the routes you want.');
    } else {
      // ---------------------------------
      // STEP 4b: Ensure auth session is still valid before crawling
      // ---------------------------------
      await ensureAuth();

      // ---------------------------------
      // STEP 5: Crawl included routes and save raw DOM snapshots
      // ---------------------------------
      console.log(`\nGenerating crawl data for ${includedUrls.length} included route(s)...`);
      await generateCrawlData(routeAnalysis, {
        businessCriticalityFilter: ['High', 'Medium', 'Low'],
        maxRoutes: null,
        outputDir: 'data/analysis',
        filterUrls: includedUrls,
      });
      console.log('Crawl data generation complete.');

      // ---------------------------------
      // STEP 6: MCP Dynamic Analysis
      // ---------------------------------
      console.log('\nRunning MCP dynamic analysis on included routes...');
      const mcpAnalyzer = new McpDynamicAnalyzer({
        storageState: 'data/storage-state.json',
        testsDir: 'data/analysis',
        baseUrl: process.env.BASE_URL,
        targetUrls: includedUrls,
        interactionLimit: parseInt(process.env.INTERACTION_LIMIT ?? '15', 10),
        headless: false,
      });

      const mcpSummary = await mcpAnalyzer.analyze();
      console.log(`MCP analysis complete.`);
      console.log(`  Routes analysed : ${mcpSummary.totalRoutes}`);
      console.log(`  Interactions    : ${mcpSummary.totalInteractions}`);
      console.log(`  State changes   : ${mcpSummary.stateChangesDetected}`);
    }

    const mins = ((Date.now() - pipelineStart) / 1000 / 60).toFixed(2);
    console.log(`\n✅ Pipeline complete in ${mins} minutes`);
  } catch (err) {
    const mins = ((Date.now() - pipelineStart) / 1000 / 60).toFixed(2);
    console.error(`Workflow crashed after ${mins} minutes:`, err);
    process.exit(1);
  }
})();
