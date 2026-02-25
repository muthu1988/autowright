require('dotenv').config();
const AuthBootstrap = require('./authBootstrap');
const RawDomCrawler = require('./crawler');
const DomAnalyzer = require('./domAnalyzer');
const RouteExplorer = require('./routeExplorer');

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
    });

    const analysisResults = await analyzer.analyze();

    // ---------------------------------
    // STEP 3: If Login → Bootstrap
    // ---------------------------------
    if (analysisResults.pageType === 'login') {

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
      });

      await explorer.explore();

      console.log('Authenticated route exploration complete.');
    }

    console.log('Workflow complete.');
    process.exit(0);

  } catch (err) {
    console.error('Workflow crashed:', err);
    process.exit(1);
  }
})();