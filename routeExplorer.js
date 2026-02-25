const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class RouteExplorer {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl;
    this.startUrl = options.startUrl;
    this.storageState = options.storageState || null;
    this.maxPages = options.maxPages || 20;

    this.visited = new Set();
    this.queue = [];
    this.routes = [];
  }

  isInternal(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === this.baseUrl;
    } catch {
      return false;
    }
  }

  normalize(url) {
    const parsed = new URL(url);
    return parsed.pathname;
  }

  async explore() {
    const browser = await chromium.launch({ headless: false });

    const context = await browser.newContext({
      storageState: this.storageState || undefined,
    });

    const page = await context.newPage();

    this.queue.push(this.startUrl);

    while (this.queue.length > 0 && this.routes.length < this.maxPages) {
      const url = this.queue.shift();

      if (this.visited.has(url)) continue;
      this.visited.add(url);

      console.log(`Visiting: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'networkidle' });

        const links = await page.$$eval('a[href]', anchors =>
          anchors.map(a => a.href)
        );

        this.routes.push(this.normalize(url));

        for (const link of links) {
          if (!this.isInternal(link)) continue;

          const normalized = this.normalize(link);
          const full = new URL(normalized, this.baseUrl).toString();

          if (!this.visited.has(full)) {
            this.queue.push(full);
          }
        }

      } catch (err) {
        console.log(`Failed to visit ${url}`);
      }
    }

    await browser.close();

    const output = {
      baseUrl: this.baseUrl,
      discoveredRoutes: this.routes,
    };

    fs.writeFileSync(
      'routes.json',
      JSON.stringify(output, null, 2)
    );

    console.log('Route discovery complete.');

    return output;
  }
}

module.exports = RouteExplorer;