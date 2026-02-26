require('dotenv').config();
const AuthBootstrap = require('./authBootstrap');
const RawDomCrawler = require('./crawler');
const DomAnalyzer = require('./domAnalyzer');
const RouteExplorer = require('./routeExplorer');
const RouteAnalyzer = require('./routeAnalyzer');
const { generateCrawlData } = require('./testDataGenerator');



(async () => {
  try {
    ``
    // ---------------------------------
    // STEP 1: Crawl Initial Page
    // ---------------------------------
    const crawler = new RawDomCrawler({
      startUrls: [process.env.START_URL],
      outputFile: 'raw-dom.json',
      headless: false,
      maxRequestsPerCrawl: 1,
      userAgent: process.env.USER_AGENT,
    });

    console.log('Starting initial crawl...');
    await crawler.run();

    // ---------------------------------
    // STEP 2: Analyze Page
    // ---------------------------------
    console.log('Analyzing page...');
    const analyzer = new DomAnalyzer({
      inputFile: 'raw-dom.json',
      outputFile: 'analysis-output.json',
      model: 'qwen2.5:7b',
      temperature: 0.1,
      enableCache: true, // Enable caching for faster development
    });

    const analysisResults = await analyzer.analyze();

    // ---------------------------------
    // STEP 3: If Login → Bootstrap
    // ---------------------------------
    if (analysisResults.pageType && analysisResults.pageType.toLowerCase().includes('login')) {

      console.log('Login page detected.');

      const authSelectors =
        await analyzer.extractAuthSelectors(analysisResults);

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

      // ---------------------------------
      // STEP 4: Crawl through the landing page and discover routes
      // ---------------------------------
      console.log('Exploring authenticated routes...');

      const explorer = new RouteExplorer({
        baseUrl: process.env.BASE_URL,
        startUrl: process.env.POST_LOGIN_URL,
        storageState: 'storage-state.json',
        maxPages: 15,
        maxRetries: 2,
      });

      await explorer.explore();

      console.log('Authenticated route exploration complete.');

      // ----------------------------------
      // STEP 5: Use LLM to analyze discovered routes and group them into categories and prioritize based on potential risk and business impact
      // ---------------------------------
      console.log('Analyzing discovered routes for risk and business impact...');

      const routeAnalyzer = new RouteAnalyzer({
        inputFile: 'routes.json',
        outputFile: 'route-analysis.json',
        model: 'qwen2.5:7b',
        temperature: 0.1,
        enableCache: true, // Enable caching for faster development
      });

      const routeAnalysis = await routeAnalyzer.analyzeRoutes();
      console.log('Route analysis complete.');
      console.log(`Categorized ${routeAnalysis.totalRoutes} routes into ${routeAnalysis.categories?.length || 0} categories.`);
      console.log(`High-risk routes identified: ${routeAnalysis.riskSummary?.high || 0}`);

      // ----------------------------------
      // STEP 6: Generate crawl data for all routes and save them in tests folder
      // ----------------------------------
      console.log('Generating crawl data for all routes...');
      await generateCrawlData(routeAnalysis, {
        businessCriticalityFilter: ['High', 'Medium', 'Low'],
        maxRoutes: null, // Remove limit to process all matching routes
        outputDir: 'tests'
      });
      console.log('Crawl data generation complete.');

    }
  } catch (err) {
    console.error('Workflow crashed:', err);
    process.exit(1);
  }
})();