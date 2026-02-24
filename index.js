const RawDomCrawler = require('./crawler');
const DomAnalyzer = require('./domAnalyzer');

(async () => {
  try {
    const crawler = new RawDomCrawler({
      startUrls: ['https://auth.rocketaccount.com/u/login'],
      outputFile: 'raw-dom.json',
      headless: false,
      maxRequestsPerCrawl: 1,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    console.log('Starting crawl...');
    await crawler.run();
    console.log('Crawl complete.');

    console.log('Starting LLM analysis...');
    const analyzer = new DomAnalyzer({
      inputFile: 'raw-dom.json',
      outputFile: 'analysis-output.json',
      model: 'qwen2.5:7b',
      temperature: 0.1,
    });

    await analyzer.analyze();

    console.log('Workflow complete.');

  } catch (err) {
    console.error('Workflow crashed:', err);
  }
})();