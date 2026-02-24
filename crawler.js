const { PlaywrightCrawler } = require('crawlee');
const fs = require('fs');

class RawDomCrawler {
  constructor(options = {}) {
    this.startUrls = options.startUrls || [];
    this.outputFile = options.outputFile || 'raw-page-data.json';
    this.results = [];

    this.crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: options.maxRequestsPerCrawl || 1,

      launchContext: {
        launchOptions: {
          headless: options.headless ?? false,
        },
      },

      preNavigationHooks: [
        async ({ page }, gotoOptions) => {
          // Set realistic viewport
          await page.setViewportSize({ width: 1280, height: 800 });

          // Override user agent if provided
          if (options.userAgent) {
            await page.setExtraHTTPHeaders({
              'User-Agent': options.userAgent,
            });
          }

          gotoOptions.waitUntil = 'domcontentloaded';
          gotoOptions.timeout = 60000;
        },
      ],

      requestHandler: async ({ request, page, response, log }) => {
        try {
          log.info(`Extracting raw DOM from: ${request.url}`);
          console.log('HTTP Status:', response?.status());

          // 1️⃣ Wait for DOM
          await page.waitForLoadState('domcontentloaded');

          // 2️⃣ Wait for network to settle (important for SPA apps)
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });

          // 3️⃣ Small stabilization delay (React hydration safety)
          await page.waitForTimeout(2000);

          const pageData = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*')).map(el => ({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              name: el.getAttribute('name'),
              type: el.getAttribute('type'),
              role: el.getAttribute('role'),
              testId: el.getAttribute('data-testid'),
              ariaLabel: el.getAttribute('aria-label'),
              placeholder: el.getAttribute('placeholder'),
              text: el.innerText?.trim() || null,
              attributes: Array.from(el.attributes).reduce((acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
              }, {}),
            }));

            return {
              metadata: {
                title: document.title,
                url: window.location.href,
                userAgent: navigator.userAgent,
              },
              elements,
            };
          });

          this.results.push(pageData);

        } catch (err) {
          log.error(`Handler error: ${err.message}`);
        }
      },

      failedRequestHandler: async ({ request, error, log }) => {
        log.error(`Request failed: ${request.url}`);
        log.error(error.message);
      },
    });
  }

  async run() {
    if (!this.startUrls.length) {
      throw new Error('No startUrls provided.');
    }

    await this.crawler.run(this.startUrls);

    fs.writeFileSync(this.outputFile, JSON.stringify(this.results, null, 2));
    console.log(`Raw page data saved to ${this.outputFile}`);
  }
}

module.exports = RawDomCrawler;