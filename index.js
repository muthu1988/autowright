require('dotenv').config();
const AuthBootstrap = require('./authBootstrap');
const RawDomCrawler = require('./crawler');
const DomAnalyzer = require('./domAnalyzer');

(async () => {
  try {
    const crawler = new RawDomCrawler({
      startUrls: [process.env.START_URL],
      outputFile: 'raw-dom.json',
      headless: false,
      maxRequestsPerCrawl: 1,
      userAgent: process.env.USER_AGENT,
    });

    console.log('Starting crawl...');
    const crawlData = await crawler.run();
    console.log('Crawl complete.');

    console.log('Starting LLM analysis...');
    const analyzer = new DomAnalyzer({
      inputFile: 'raw-dom.json',
      outputFile: 'analysis-output.json',
      model: 'qwen2.5:7b',
      temperature: 0.1,
    });

    const analysisResults = await analyzer.analyze();

    if (analysisResults.pageType === 'login') {

      const authSelectors = await analyzer.extractAuthSelectors(analysisResults);

      console.log('Extracted Auth Selectors:', JSON.stringify(authSelectors, null, 2));

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

      try {
        await auth.login();
      } catch (err) {
        console.error(err);
      }
    }

    console.log('Workflow complete.');
    process.exit(0);

  } catch (err) {
    console.error('Workflow crashed:', err);
    process.exit(1);
  }
})();