require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AuthBootstrap = require('./authBootstrap');
const RawDomCrawler = require('./crawler');
const DomAnalyzer = require('./domAnalyzer');
const RouteExplorer = require('./routeExplorer');
const RouteAnalyzer = require('./routeAnalyzer');
const { generateCrawlData } = require('./testDataGenerator');

class FlowTester {
  constructor() {
    this.analyzer = new DomAnalyzer({
      inputFile: 'raw-dom.json',
      outputFile: 'analysis-output.json',
      model: 'qwen2.5:7b',
      temperature: 0.1,
      enableCache: true, // Enable caching for faster development
    });
  }

  /**
   * Load existing analysis results from output folder
   */
  loadExistingAnalysis() {
    try {
      const analysisPath = path.join('output', 'analysis-output.json');
      if (!fs.existsSync(analysisPath)) {
        throw new Error('Analysis output not found. Please run steps 1-2 first.');
      }
      
      const analysisData = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
      // High-level: loaded analysis log
      console.log('Loaded existing analysis results from output folder');
      return analysisData;
    } catch (error) {
      throw new Error(`Failed to load analysis results: ${error.message}`);
    }
  }

  /**
   * Test Flow 1: Authentication Flow (using existing analysis)
   * Tests auth selector extraction and login process with existing data
   */
  async testAuthFlow() {
    // High-level: test start log
    console.log('Testing Authentication Flow (using existing data)');
    
    try {
      // Load existing analysis results
      // High-level: step log
      console.log('Loading existing analysis results...');
      const analysisResults = this.loadExistingAnalysis();
      
      if (analysisResults.pageType !== 'login') {
        console.log('❌ Not a login page, skipping auth flow test');
        return { success: false, reason: 'Not a login page' };
      }

      // High-level: login page detected log
      console.log('Login page detected from existing analysis');

      // Extract auth selectors
      // High-level: extracting selectors log
      console.log('Extracting authentication selectors...');
      const authSelectors = await this.analyzer.extractAuthSelectors(analysisResults);
      // High-level: selectors extracted log
      console.log('Auth selectors extracted');

      // Test login process
      // High-level: login process log
      console.log('Testing login process...');
      const auth = new AuthBootstrap({
        baseUrl: process.env.BASE_URL,
        loginUrl: process.env.LOGIN_URL,
        username: process.env.LOGIN_USERNAME,
        password: process.env.PASSWORD,
        usernameSelector: authSelectors.usernameSelector,
        passwordSelector: authSelectors.passwordSelector,
        submitSelector: authSelectors.submitSelector,
        successUrlContains: process.env.SUCCESS_URL_CONTAINS,
      });

      await auth.login();
      // High-level: auth flow success log
      console.log('Authentication flow completed successfully');
      
      return { 
        success: true, 
        data: { 
          analysisResults, 
          authSelectors 
        } 
      };

    } catch (error) {
      // High-level: auth flow error log
      console.error('Authentication flow failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test Flow 2: Route Exploration Flow
   * Tests authenticated route discovery
   */
  async testRouteExplorationFlow() {
    console.log('\n=== Testing Route Exploration Flow ===');
    
    try {
      console.log('1. Initializing route explorer...');
      const explorer = new RouteExplorer({
        baseUrl: process.env.BASE_URL,
        startUrl: process.env.POST_LOGIN_URL,
        storageState: 'storage-state.json',
        maxPages: 5, // Reduced for testing
        maxRetries: 2, // Retry failed routes
      });

      console.log('2. Starting route exploration...');
      const routes = await explorer.explore();
      
      console.log('✅ Route exploration completed');
      console.log(`✅ Discovered ${routes.discoveredRoutes?.length || 0} successful routes`);
      console.log(`❌ Failed ${routes.failedRoutes?.length || 0} routes (after retries)`);
      console.log(`🚫 Skipped ${routes.skippedLogoutRoutes?.length || 0} logout routes`);
      console.log(`🗂️ Navigation menus: ${routes.navigationMetadata?.totalMenus || 0}`);
      
      if (routes.discoveredRoutes && routes.discoveredRoutes.length > 0) {
        console.log('Sample successful routes:', routes.discoveredRoutes.slice(0, 3));
      }

      if (routes.navigationStructure && routes.navigationStructure.length > 0) {
        console.log('Sample navigation menus:');
        routes.navigationStructure.slice(0, 2).forEach((menu, index) => {
          console.log(`   ${index + 1}. ${menu.menuName} (${menu.routeCount} routes)`);
        });
      }
      
      if (routes.failedRoutes && routes.failedRoutes.length > 0) {
        console.log('Sample failed routes:', routes.failedRoutes.slice(0, 2).map(f => `${f.url} (${f.retryAttempts} attempts - ${f.error})`));
      }

      return { 
        success: true, 
        data: routes 
      };

    } catch (error) {
      console.error('❌ Route exploration flow failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test Steps 3 & 4: Authentication + Route Exploration in sequence
   * Uses existing analysis data and runs auth + routes in one go
   */
  async testAuthAndRoutes() {
    console.log('\n=== Testing Steps 3 & 4: Auth + Route Exploration ===');
    
    try {
      // Validate environment variables
      console.log('0. Validating environment configuration...');
      const requiredEnvVars = ['BASE_URL', 'LOGIN_URL', 'POST_LOGIN_URL', 'LOGIN_USERNAME', 'PASSWORD', 'SUCCESS_URL_CONTAINS'];
      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
      }
      
      console.log('✅ All required environment variables are set');
      console.log(`   LOGIN_URL: ${process.env.LOGIN_URL}`);
      console.log(`   POST_LOGIN_URL: ${process.env.POST_LOGIN_URL}`);
      console.log(`   BASE_URL: ${process.env.BASE_URL}`);

      // Load existing analysis results
      console.log('1. Loading existing analysis results...');
      const analysisResults = this.loadExistingAnalysis();
      
      if (analysisResults.pageType !== 'login') {
        console.log('❌ Not a login page, skipping auth flow');
        return { success: false, reason: 'Not a login page' };
      }

      console.log('✅ Login page detected from existing analysis');

      // STEP 3: Authentication Flow
      console.log('\n--- STEP 3: Authentication ---');
      console.log('2. Extracting authentication selectors...');
      const authSelectors = await this.analyzer.extractAuthSelectors(analysisResults);
      console.log('✅ Auth selectors extracted:', {
        username: authSelectors.usernameSelector,
        password: authSelectors.passwordSelector,
        submit: authSelectors.submitSelector
      });

      console.log('3. Performing login...');
      const auth = new AuthBootstrap({
        baseUrl: process.env.BASE_URL,
        loginUrl: process.env.LOGIN_URL,
        username: process.env.LOGIN_USERNAME,
        password: process.env.PASSWORD,
        usernameSelector: authSelectors.usernameSelector,
        passwordSelector: authSelectors.passwordSelector,
        submitSelector: authSelectors.submitSelector,
        successUrlContains: process.env.SUCCESS_URL_CONTAINS,
      });

      await auth.login();
      console.log('✅ Authentication completed successfully');

      // STEP 4: Route Exploration Flow
      console.log('\n--- STEP 4: Route Exploration ---');
      
      // Check if storage state exists
      const storageStatePath = 'storage-state.json';
      if (!fs.existsSync(storageStatePath)) {
        throw new Error('❌ storage-state.json not found! Authentication might have failed.');
      }
      
      console.log('✅ storage-state.json exists');
      console.log('4. Initializing route explorer...');
      console.log(`   Starting URL: ${process.env.POST_LOGIN_URL}`);
      console.log(`   Base URL: ${process.env.BASE_URL}`);
      
      // Check for domain mismatch
      const startDomain = new URL(process.env.POST_LOGIN_URL).origin;
      const baseDomain = process.env.BASE_URL;
      if (startDomain !== baseDomain) {
        console.log(`⚠️  Domain mismatch detected:`);
        console.log(`   Auth domain: ${baseDomain}`);
        console.log(`   Exploration domain: ${startDomain}`);
        console.log(`   Route exploration will use: ${startDomain}`);
      }
      
      const explorer = new RouteExplorer({
        baseUrl: process.env.BASE_URL,
        startUrl: process.env.POST_LOGIN_URL,
        storageState: storageStatePath,
        maxPages: 60, // Full exploration
        maxRetries: 2, // Retry failed routes up to 2 times
      });

      console.log('5. Starting route exploration...');
      const routes = await explorer.explore();
      
      console.log('✅ Route exploration completed successfully');
      console.log(`✅ Discovered ${routes.discoveredRoutes?.length || 0} successful routes`);
      console.log(`❌ Failed ${routes.failedRoutes?.length || 0} routes (after ${routes.configuration?.maxRetries || 0} retries each)`);
      console.log(`🚫 Skipped ${routes.skippedLogoutRoutes?.length || 0} logout routes`);
      console.log(`🗂️ Navigation menus extracted: ${routes.navigationMetadata?.totalMenus || 0}`);
      
      if (routes.discoveredRoutes && routes.discoveredRoutes.length > 0) {
        console.log('📋 Sample successful routes:', routes.discoveredRoutes.slice(0, 5));
      }

      if (routes.navigationStructure && routes.navigationStructure.length > 0) {
        console.log('🗂️ Navigation menus discovered:');
        routes.navigationStructure.slice(0, 3).forEach((menu, index) => {
          const subMenuText = menu.subMenus?.length > 0 ? ` + ${menu.subMenus.length} sub-menus` : '';
          console.log(`   ${index + 1}. ${menu.menuName} (${menu.routeCount} routes${subMenuText})`);
        });
        if (routes.navigationStructure.length > 3) {
          console.log(`   ... and ${routes.navigationStructure.length - 3} more menus`);
        }
      }
      
      if (routes.failedRoutes && routes.failedRoutes.length > 0) {
        console.log('🔍 Failed routes (after all retries):');
        routes.failedRoutes.forEach((failed, index) => {
          if (index < 3) { // Show first 3 failed routes
            console.log(`   ${index + 1}. ${failed.url} - ${failed.error} (${failed.retryAttempts} attempts)`);
          }
        });
        if (routes.failedRoutes.length > 3) {
          console.log(`   ... and ${routes.failedRoutes.length - 3} more (see output/routes.json)`);
        }
      }
      
      if (routes.skippedLogoutRoutes && routes.skippedLogoutRoutes.length > 0) {
        console.log('🛡️ Logout routes were automatically skipped to preserve session');
      }

      // STEP 5: Route Analysis
      console.log('\n--- STEP 5: Route Analysis ---');
      console.log('6. Analyzing routes for risk and business impact...');
      
      const routeAnalyzer = new RouteAnalyzer({
        inputFile: 'routes.json',
        outputFile: 'route-analysis.json',
        model: 'qwen2.5:7b',
        temperature: 0.1,
        enableCache: true,
      });

      const routeAnalysis = await routeAnalyzer.analyzeRoutes();
      console.log('✅ Route analysis completed');
      console.log(`📊 Categorized ${routeAnalysis.totalRoutes} routes into ${routeAnalysis.menuSummary?.totalMenus || 0} navigation menus`);
      console.log(`🏠 Main menus: ${routeAnalysis.menuSummary?.mainMenus || 0}`);
      console.log(`🔴 High-risk routes: ${routeAnalysis.riskSummary?.high || 0}`);
      console.log(`🟡 Medium-risk routes: ${routeAnalysis.riskSummary?.medium || 0}`);
      console.log(`🟢 Low-risk routes: ${routeAnalysis.riskSummary?.low || 0}`);
      
      if (routeAnalysis.priorityTargets && routeAnalysis.priorityTargets.length > 0) {
        console.log(`🎯 Priority testing targets: ${routeAnalysis.priorityTargets.length}`);
      }

      console.log('\n🎉 Steps 3, 4 & 5 completed successfully!');
      console.log('📋 Navigation-based route analysis provides menu-structured security insights!');
      return { 
        success: true, 
        data: { 
          authSelectors,
          routes,
          routeAnalysis
        } 
      };

    } catch (error) {
      console.error('❌ Steps 3 & 4 failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test only route exploration (assumes auth state exists)
   */
  async testRouteExplorationOnly() {
    console.log('\n=== Testing Route Exploration Only ===');
    console.log('⚠️  This assumes storage-state.json exists from previous auth');
    
    return await this.testRouteExplorationFlow();
  }

  /**
   * Test only route analysis (assumes routes.json exists)
   */
  async testRouteAnalysisOnly() {
    console.log('\n=== Testing Route Analysis Only ===');
    console.log('⚠️  This assumes output/routes.json exists from previous route exploration');
    
    try {
      console.log('1. Initializing route analyzer...');
      
      const routeAnalyzer = new RouteAnalyzer({
        inputFile: 'routes.json',
        outputFile: 'route-analysis.json',
        model: 'qwen2.5:7b',
        temperature: 0.1,
        enableCache: true,
      });

      console.log('2. Analyzing routes for security risk and business impact...');
      const routeAnalysis = await routeAnalyzer.analyzeRoutes();
      
      console.log('✅ Route analysis completed successfully');
      console.log(`📊 Analysis Summary:`);
      console.log(`   Total routes analyzed: ${routeAnalysis.totalRoutes}`);
      console.log(`   Navigation menus created: ${routeAnalysis.menuSummary?.totalMenus || 0}`);
      console.log(`   🏠 Main menus: ${routeAnalysis.menuSummary?.mainMenus || 0}`);
      console.log(`   📂 Sub-menus: ${routeAnalysis.menuSummary?.subMenus || 0}`);
      console.log(`   📄 Standalone pages: ${routeAnalysis.menuSummary?.standalonePages || 0}`);
      console.log(`   🔴 High-risk routes: ${routeAnalysis.riskSummary?.high || 0}`);
      console.log(`   🟡 Medium-risk routes: ${routeAnalysis.riskSummary?.medium || 0}`);
      console.log(`   🟢 Low-risk routes: ${routeAnalysis.riskSummary?.low || 0}`);
      console.log(`   🎯 Priority targets: ${routeAnalysis.priorityTargets?.length || 0}`);
      
      if (routeAnalysis.navigationStructure && routeAnalysis.navigationStructure.length > 0) {
        console.log('\n🗂️ Navigation Structure:');
        routeAnalysis.navigationStructure.forEach((menu, index) => {
          const subMenuCount = menu.subMenus?.length || 0;
          const subMenuText = subMenuCount > 0 ? ` + ${subMenuCount} sub-menus` : '';
          console.log(`   ${index + 1}. ${menu.menuName} (${menu.routes?.length || 0} routes${subMenuText}, Risk: ${menu.riskLevel})`);
        });
      }

      return {
        success: true,
        data: routeAnalysis
      };

    } catch (error) {
      console.error('❌ Route analysis failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test Step 6: High Priority Test Data Generation
   * Generates crawl data for top 3 high business criticality routes
   */
  async testHighPriorityDataGeneration() {
    console.log('\n=== Testing Step 6: High Priority Test Data Generation ===');
    console.log('⚠️  This assumes output/route-analysis.json exists from previous route analysis');
    
    try {
      // Load existing route analysis results
      console.log('1. Loading route analysis results...');
      const routeAnalysisPath = path.join('output', 'route-analysis.json');
      if (!fs.existsSync(routeAnalysisPath)) {
        throw new Error('Route analysis output not found. Please run route analysis (Step 5) first.');
      }
      
      const routeAnalysis = JSON.parse(fs.readFileSync(routeAnalysisPath, 'utf8'));
      console.log('✅ Loaded existing route analysis results');
      console.log(`   Total routes: ${routeAnalysis.totalRoutes}`);
      console.log(`   Navigation structure entries: ${routeAnalysis.navigationStructure?.length || 0}`);
      
      // Check for high criticality routes
      const highCriticalityCount = routeAnalysis.navigationStructure
        ?.filter(route => route.businessCriticality === 'High')?.length || 0;
      console.log(`   High business criticality routes found: ${highCriticalityCount}`);
      
      if (highCriticalityCount === 0) {
        console.log('⚠️  No high business criticality routes found to generate test data for');
        return { success: false, reason: 'No high criticality routes found' };
      }

      // Check authentication state
      const storageStatePath = 'storage-state.json';
      if (!fs.existsSync(storageStatePath)) {
        throw new Error('❌ storage-state.json not found! Please run authentication flow first.');
      }
      console.log('✅ Authentication state found');

      console.log('2. Generating crawl data for all business criticality routes...');
      await generateCrawlData(routeAnalysis, {
        businessCriticalityFilter: ['High', 'Medium', 'Low'],
        maxRoutes: null, // Remove limit to process all matching routes
        outputDir: 'tests'
      });
      
      console.log('✅ High priority test data generation completed successfully');
      
      // Check what was generated
      const testsDir = path.join(process.cwd(), 'tests');
      if (fs.existsSync(testsDir)) {
        // Count files recursively in the nested structure
        const countFilesRecursively = (dir) => {
          let count = 0;
          const items = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of items) {
            if (item.isDirectory()) {
              count += countFilesRecursively(path.join(dir, item.name));
            } else if (item.name.endsWith('.json')) {
              count++;
            }
          }
          return count;
        };
        
        const totalFiles = countFilesRecursively(testsDir);
        const topLevelFiles = fs.readdirSync(testsDir, { withFileTypes: true });
        const summaryFiles = topLevelFiles.filter(f => f.isFile() && (f.name.includes('summary') || f.name.includes('crawl-summary'))).length;
        
        console.log(`📁 Generated files in tests/: ${totalFiles} total JSON files`);
        console.log(`   - Summary files: ${summaryFiles}`);
        console.log(`   - Route data: Each route has one raw-dom.json file (like Step 1)`);
        console.log(`   - Duplicates automatically skipped`);
      }

      return {
        success: true,
        data: {
          routeAnalysis,
          generatedFiles: testsDir
        }
      };

    } catch (error) {
      console.error('❌ High priority data generation failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// CLI Interface
async function main() {
  const tester = new FlowTester();
  const command = process.argv[2] || 'help';

  switch (command) {
    case 'auth':
      console.log('🧪 Testing Authentication Flow Only (using existing data)');
      await tester.testAuthFlow();
      break;
      
    case 'routes':
      console.log('🧪 Testing Route Exploration Only');
      await tester.testRouteExplorationOnly();
      break;

    case 'analyze':
      console.log('🧪 Testing Route Analysis Only');
      await tester.testRouteAnalysisOnly();
      break;
      
    case 'generate':
    case 'step6':
      console.log('🧪 Testing Step 6: High Priority Test Data Generation');
      await tester.testHighPriorityDataGeneration();
      break;
      
    case 'steps34':
    case 'main':
      console.log('🧪 Testing Steps 3, 4 & 5: Auth + Routes + Analysis (using existing data)');
      await tester.testAuthAndRoutes();
      break;
      
    case 'help':
    default:
      console.log(`
🧪 Flow Tester Usage (Steps 3, 4 & 5 Focus):

node test-flows.js steps34  - Test auth + routes + analysis using existing data (MAIN)
node test-flows.js main     - Same as steps34 (alias)
node test-flows.js auth     - Test authentication flow only (using existing data)
node test-flows.js routes   - Test route exploration only (needs existing auth state)
node test-flows.js analyze  - Test route analysis only (needs existing routes data)
node test-flows.js generate - Test Step 6: Generate high priority test data (needs route analysis)
node test-flows.js step6    - Same as generate (alias)
node test-flows.js help     - Show this help

📋 Prerequisites:
- Run steps 1-2 first to generate analysis data in output folder
- Required files: output/analysis-output.json, output/raw-dom.json
- For route analysis: output/routes.json (from route exploration)
- For test data generation: output/route-analysis.json + storage-state.json

🔧 Environment variables required:
- BASE_URL, LOGIN_URL, POST_LOGIN_URL
- LOGIN_USERNAME, PASSWORD  
- SUCCESS_URL_CONTAINS
- USER_AGENT (optional)

💡 Recommended workflow:
1. Run main app steps 1-2 OR ensure output/analysis-output.json exists
2. Run: node test-flows.js steps34 (full flow with analysis)
3. Or run: node test-flows.js analyze (just route analysis if routes exist)

📊 New Features:
- Real-time navigation menu extraction during crawling
- DOM-based menu hierarchy detection (main/sub-menus) 
- Automatic route organization by navigation structure
- Route risk assessment (High/Medium/Low)
- Business criticality evaluation
- Security testing priority recommendations
- Navigation-aware route categorization
      `);
      break;
  }

  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = FlowTester;